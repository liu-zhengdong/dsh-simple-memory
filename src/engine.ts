/**
 * 注入引擎：把 pi-memory 的「每轮提供索引 + 按需关键词提醒」搬到 DSH。
 *
 * 与 Pi 版的分工差异：
 * - 文本的落点不再是系统提示词，而是 `ctx.systemPrompt.context` 造的运行时上下文
 *   快照（由宿主负责去重与压缩后重建）；
 * - 这里只负责算出「这一刻应该提供的文本」，并且不依赖任何宿主 API，
 *   方便用假 agent 直接测试。
 */
import { isAbsolute, join, resolve, win32 } from "node:path";
import { homedir } from "node:os";
import type { MemoryConfig } from "./config.ts";
import type { AgentLike, MessageLike, SessionEventLike } from "./dsh.ts";
import { KeywordIndex } from "./keywords.ts";
import {
  discoverMemoryDirectories,
  MemoryLoader,
  previewSnapshot,
  resolveSources,
  type Snapshot,
} from "./memory.ts";
import { Reminders } from "./reminders.ts";
import { escapeTemplateBraces, joinBlocks } from "./text.ts";

export interface PluginConfig {
  /** 全局记忆目录；空串表示不配置全局来源。 */
  directory: string;
  /** 是否从工作目录向上发现项目内的 `.memory`。 */
  projectSources: boolean;
  /** 是否启用关键词提醒。 */
  reminders: boolean;
  maxContextBytes: number;
}

/**
 * 判断路径是不是绝对路径。本机判据之外再认 Windows 形式（`C:\...`、`\\server\share`）：
 * 配置会跟着 profile 走，在 Mac 上写好的文件可能被拷到 Windows 上读，反之亦然，
 * 只按运行平台判断会让另一侧写好的值在加载时报错。
 */
export function isAbsolutePath(value: string): boolean {
  return isAbsolute(value) || win32.isAbsolute(value);
}

/**
 * 把配置里的目录整理成绝对路径；空串表示不配置。
 *
 * 路径要是 Windows 形式（而本机不是 Windows），交给 `win32.resolve` 去规范化：
 * 本机的 `resolve` 会把 `C:\x` 当成相对段拼到当前工作目录后面，得到一个既不
 * 存在、又不报错的路径——比直接拒绝更难查。这样该值的本机可读性由后续的目录
 * 探测去判定，这里只保证形状不被改写。
 */
export function resolveDirectory(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const expanded =
    value === "~"
      ? homedir()
      : value.startsWith("~/")
        ? join(homedir(), value.slice(2))
        : value;
  if (isAbsolute(expanded)) return resolve(expanded);
  if (win32.isAbsolute(expanded)) return win32.resolve(expanded);
  throw new Error(
    `记忆目录必须是绝对路径（Windows 写 C:\\... 或 \\\\server\\share，可以写 ~ 开头）：${input}`,
  );
}

export function memoryConfig(config: PluginConfig): MemoryConfig {
  return {
    directory: resolveDirectory(config.directory),
    maxContextBytes: config.maxContextBytes,
  };
}

interface AgentState {
  index: KeywordIndex;
  reminders: Reminders;
  /** 已经看过关键词的会话事件序号。 */
  cursor: number;
  /** 是否已经为恢复的会话定过基准。 */
  primed: boolean;
  /** 已经按 id 计过数的消息，避免日志补齐时重复提醒。 */
  seen: Set<string>;
  chain: Promise<void>;
  snapshot?: Snapshot;
  text: string;
  /** 最近一次 `remind()` 算出的关键词提醒文本。 */
  reminder: string;
}

export interface EngineStatus {
  directory: string | null;
  sources: { kind: string; path: string; notes: number; bytes: number; skipped?: string }[];
  bytes: number;
  issues: string[];
  reminders: number;
  indexed: number;
  injected: boolean;
}

/** 从消息里取出纯文本；无法识别的形状返回空串。 */
export function messageText(message: MessageLike | undefined): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (typeof block?.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n");
}

export class MemoryEngine {
  private readonly loader = new MemoryLoader();
  private readonly states = new WeakMap<object, AgentState>();
  // 不能用 TS 构造器参数属性：Node 的类型剥离模式不支持，运行时会报
  // ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX。
  private readonly readConfig: () => PluginConfig;

  constructor(readConfig: () => PluginConfig) {
    this.readConfig = readConfig;
  }

  /**
   * 让缓存立刻反映磁盘，并返回这一刻应该注入的**记忆索引**。
   *
   * 关键词提醒不在这里取：组装期（`system-prompt/assemble`）的会话日志里还没有
   * 本步刚认领的用户消息，取不出命中；提醒统一走 `remind()`。
   */
  async refresh(agent: AgentLike | undefined): Promise<string> {
    const state = this.stateFor(agent);
    if (!state) return "";
    const run = state.chain.then(() => this.update(agent!, state));
    state.chain = run.then(
      () => undefined,
      () => undefined,
    );
    await state.chain;
    return state.text;
  }

  /** 后台预热：只为同步的 context provider 准备兜底文本。 */
  warm(agent: AgentLike | undefined): void {
    const state = this.stateFor(agent);
    if (!state) return;
    const run = state.chain.then(() => this.update(agent!, state));
    state.chain = run.then(
      () => undefined,
      () => undefined,
    );
    void state.chain.catch(() => undefined);
  }

  /**
   * 取本步要提供的关键词提醒。
   *
   * `claimed` 是本步刚认领、还没来得及写进会话日志的消息（pre-step 的
   * `decision.messages` 原样带过来），所以必须单独看，否则永远慢一步。
   */
  async remind(
    agent: AgentLike | undefined,
    claimed?: readonly MessageLike[],
  ): Promise<string> {
    const state = this.stateFor(agent);
    if (!state || !agent) return "";
    const run = state.chain.then(async () => {
      state.reminder = "";
      await this.update(agent, state);
      const config = this.readConfig();
      if (!config.reminders || !state.snapshot) return;
      for (const message of claimed ?? []) this.captureMessage(state, message);
      state.reminder = state.reminders.take(state.snapshot.bytes).text;
    });
    state.chain = run.then(
      () => undefined,
      () => undefined,
    );
    await state.chain;
    return state.reminder;
  }

  /** 已经算好的注入文本；组装时同步可读。 */
  cached(agent: AgentLike | undefined): string {
    return this.stateFor(agent)?.text ?? "";
  }

  status(agent: AgentLike | undefined): EngineStatus {
    const state = this.stateFor(agent);
    const snapshot = state?.snapshot;
    return {
      directory: snapshot?.directory ?? safeDirectory(this.readConfig),
      sources: (snapshot?.sources ?? []).map((source) => ({
        kind: source.kind,
        path: source.path,
        notes: source.notes.length,
        bytes: source.bytes,
        skipped: source.skipped,
      })),
      bytes: snapshot?.bytes ?? 0,
      issues: snapshot?.issues ?? [],
      reminders: state?.reminders.pendingPaths.length ?? 0,
      indexed: state?.index.notes.size ?? 0,
      injected: Boolean(state?.text),
    };
  }

  preview(agent: AgentLike | undefined): string {
    const state = this.stateFor(agent);
    if (!state?.snapshot) return "还没有扫描过记忆目录，先发一条消息或稍后重试。";
    const parts = [previewSnapshot(state.snapshot)];
    if (state.index.issues.length)
      parts.push(
        ["## 关键词索引提醒", ...state.index.issues.map((i) => `- ${i}`)].join(
          "\n",
        ),
      );
    const pending = state.reminders.pendingPaths;
    if (pending.length)
      parts.push(
        ["## 待提醒（尚未提供）", ...pending.map((path) => `- ${path}`)].join(
          "\n",
        ),
      );
    return parts.filter(Boolean).join("\n\n");
  }

  /** 会话恢复或压缩后重新对账。 */
  reset(agent: AgentLike | undefined): void {
    const state = this.stateFor(agent);
    if (!state) return;
    state.reminders.reset();
    state.cursor = -1;
    state.primed = false;
    state.seen.clear();
    state.text = "";
    state.reminder = "";
  }

  private stateFor(agent: AgentLike | undefined): AgentState | undefined {
    const key = stateKey(agent);
    if (!key) return undefined;
    let state = this.states.get(key);
    if (!state) {
      const index = new KeywordIndex();
      state = {
        index,
        reminders: new Reminders(index),
        cursor: -1,
        primed: false,
        seen: new Set<string>(),
        chain: Promise.resolve(),
        text: "",
        reminder: "",
      };
      this.states.set(key, state);
    }
    return state;
  }

  private async update(agent: AgentLike, state: AgentState): Promise<void> {
    const config = this.readConfig();
    const memory = memoryConfig(config);
    const cwd = agent.session?.header?.cwd;
    const discovery =
      config.projectSources && cwd
        ? await discoverMemoryDirectories(cwd)
        : { paths: [], issues: [] };
    const sources = resolveSources(memory, discovery, () => true);
    const snapshot = await this.loader.scan(memory, sources);
    state.snapshot = snapshot;
    if (!config.reminders) {
      state.text = escapeTemplateBraces(snapshot.text);
      return;
    }
    await state.index.refresh(snapshot);
    state.reminders.configure(snapshot, config.maxContextBytes);
    this.capture(state, agent);
    state.text = escapeTemplateBraces(snapshot.text);
  }

  /** 按消息 id 去重后，把一条消息的文本交给关键词匹配。 */
  private captureMessage(state: AgentState, message: MessageLike | undefined): void {
    if (!message) return;
    const id = typeof message.id === "string" ? message.id : undefined;
    if (id) {
      if (state.seen.has(id)) return;
      // 界限：长会话里只留最近的一批 id；重复计数本身被 Reminders 的 provided 兜住。
      if (state.seen.size > 4096) state.seen.clear();
      state.seen.add(id);
    }
    state.reminders.capture(messageText(message));
  }

  /**
   * 记录新出现的用户输入与模型文本里的关键词命中。
   *
   * 会话事件按 `session.seq`（已记录事件的条数）枚举：`surface.nodes` 在一步
   * 的组装期还是空的（投影要等这一步提交），靠它读当轮用户输入会晚一步——
   * 第一方 dsh-time-context 也是直接用 `session.seq - 1` 往前扫的。
   */
  private capture(state: AgentState, agent: AgentLike): void {
    const session = agent.session;
    const eventAt = session?.eventAt;
    if (!session || typeof eventAt !== "function") return;
    const read = (seq: number): SessionEventLike | undefined =>
      eventAt.call(session, seq);
    const total = session.seq;
    const seqs: readonly number[] =
      typeof total === "number" && Number.isSafeInteger(total) && total > 0
        ? Array.from({ length: total }, (_value, index) => index)
        : (session.surface?.nodes ?? []);
    if (!seqs.length) return;
    if (!state.primed) {
      state.primed = true;
      // 恢复的长会话不追溯历史：只从最后一条真实用户消息开始，避免旧消息成批提醒。
      let last = -1;
      for (const seq of seqs) {
        const event = read(seq);
        if (event?.type === "user/message" && event.data?.source?.kind === "user")
          last = seq;
      }
      if (last >= 0) state.cursor = Math.max(state.cursor, last - 1);
    }
    let max = state.cursor;
    const cursorBefore = state.cursor;
    const messages: MessageLike[] = [];
    for (const seq of seqs) {
      if (seq > max) max = seq;
      if (seq <= state.cursor) continue;
      const event = read(seq);
      if (!event) continue;
      if (event.type === "user/message" && event.data?.source?.kind === "user")
        messages.push(event.data);
      else if (event.type === "assistant/message" && event.data)
        messages.push(event.data);
    }
    state.cursor = max;
    for (const message of messages) this.captureMessage(state, message);
    if (process.env.DSH_SIMPLE_MEMORY_DEBUG) {
      const seen = seqs
        .map(
          (seq) =>
            `${seq}:${read(seq)?.type ?? "?"}:${read(seq)?.data?.source?.kind ?? ""}`,
        )
        .join(" ");
      console.error(
        "[simple-memory] capture seq=%s cursor=%d->%d texts=%d pending=%o | %s",
        String(total),
        cursorBefore,
        state.cursor,
        messages.length,
        state.reminders.pendingPaths,
        seen,
      );
    }
  }
}

function stateKey(agent: AgentLike | undefined): object | undefined {
  if (!agent) return undefined;
  return (agent.session as object | undefined) ?? (agent as object);
}

function safeDirectory(readConfig: () => PluginConfig): string | null {
  try {
    return resolveDirectory(readConfig().directory);
  } catch {
    return null;
  }
}
