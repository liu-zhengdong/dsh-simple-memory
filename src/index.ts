/**
 * dsh-simple-memory：把用户自己维护的 Markdown 记忆目录接入 DSH。
 *
 * 每一轮只把「索引」放进上下文：根层记忆的名称、绝对路径、`description`/`purpose`
 * 定位，以及子文件夹入口；`defaultopen: true` 的记忆才带全文。更深层的记忆不进
 * 默认上下文，靠上层正文里的 `[[路径]]` 引用，或 frontmatter `keywords` 的字面短语
 * 命中来按需提醒。全文始终由模型自己用 read 工具读取，插件只读不改用户的目录。
 *
 * 注入走 `ctx.systemPrompt.context`：宿主把它物化成一条 user 角色的运行时上下文
 * 快照，文本不变就不重复注入，被压缩掉以后自动整段重建。扫描是异步的，而
 * context 的文本只能同步返回，所以真正的新鲜内容在 `system-prompt/assemble`
 * waterfall 里写回；注册的 context 用缓存文本兜底。
 */
import Schema from "@deepseek-ai/schemastery";
import { randomUUID } from "node:crypto";
import { registerMemoryCommand } from "./command.ts";
import { DEFAULT_MAX_CONTEXT_BYTES } from "./config.ts";
import type {
  AssembleContextLike,
  MessageLike,
  PluginContextLike,
  PreStepDecisionLike,
  PreStepEventLike,
  PromptAssemblyLike,
} from "./dsh.ts";
import { MemoryEngine, type PluginConfig } from "./engine.ts";

export const name = "dsh-simple-memory";

/** 注入要落在提示词组装上，所以声明 systemPrompt 依赖。 */
export const inject = ["systemPrompt"];

export interface Config extends PluginConfig {}

export const Config = Schema.object({
  directory: Schema.string()
    .default("")
    .description("全局记忆目录的绝对路径（可写 ~ 开头）；留空表示不使用全局来源"),
  projectSources: Schema.boolean()
    .default(true)
    .description("从工作目录向上到 git 根逐层发现 .memory 项目记忆"),
  reminders: Schema.boolean()
    .default(true)
    .description("按 frontmatter 的 keywords 命中用户输入或模型文本时提醒"),
  maxContextBytes: Schema.number()
    .default(DEFAULT_MAX_CONTEXT_BYTES)
    .min(1024)
    .max(16 * 1024 * 1024)
    .description("每轮注入的记忆文本上限（UTF-8 字节）"),
});

/** runtime context 段名；注入文本的唯一标识。 */
export const CONTEXT_NAME = "simple-memory";
/** 外部贡献可以用任意有限的顺序值；第一方 context 只占 110/115/120。 */
export const CONTEXT_ORDER = 9000;

export function apply(ctx: PluginContextLike, config: Config): void {
  const readConfig = (): PluginConfig => ({
    directory: typeof config.directory === "string" ? config.directory : "",
    projectSources: config.projectSources !== false,
    reminders: config.reminders !== false,
    maxContextBytes:
      Number.isSafeInteger(config.maxContextBytes) &&
      config.maxContextBytes >= 1024
        ? config.maxContextBytes
        : DEFAULT_MAX_CONTEXT_BYTES,
  });
  const engine = new MemoryEngine(readConfig);

  // ① 兜底：即使下面的 waterfall 没跑成，组装也能拿到上一次算好的文本。
  //    缓存还空的时候顺手预热一次（预热不消费关键词提醒，消费只归 waterfall）。
  ctx.systemPrompt.context({
    name: CONTEXT_NAME,
    order: CONTEXT_ORDER,
    text: (context: AssembleContextLike) => {
      const agent = context?.agent;
      const cached = engine.cached(agent);
      if (!cached) engine.warm(agent);
      return cached;
    },
  });

  // ② 权威路径：组装 waterfall 可以异步，正好用来在每次组装前重新扫描磁盘，
  //    并用同名替换保证只注入一段。
  ctx.on(
    "system-prompt/assemble",
    async (...args: unknown[]): Promise<PromptAssemblyLike | undefined> => {
      const assembly = args[0] as PromptAssemblyLike | undefined;
      const context = args[1] as AssembleContextLike | undefined;
      const next = args[2] as
        | (() => Promise<PromptAssemblyLike | undefined>)
        | undefined;
      const base =
        typeof next === "function" ? await next() : (assembly ?? undefined);
      const agent = context?.agent;
      if (!base || !Array.isArray(base.contexts) || !agent) return base;
      try {
        const text = await engine.refresh(agent);
        const contexts = base.contexts.filter(
          (entry) => entry?.name !== CONTEXT_NAME,
        );
        if (text) contexts.push({ name: CONTEXT_NAME, order: CONTEXT_ORDER, text });
        return { ...base, contexts };
      } catch (error) {
        ctx.logger?.warn?.("simple-memory 刷新失败：%o", error);
        return base;
      }
    },
  );

  // ③ 关键词提醒：只能走 pre-step。
  //    组装（system-prompt/assemble）发生在认领用户消息之后，但那一刻会话日志里
  //    还没有这条消息（实测 `session.seq` 末尾只有 agent/inbox/spliced），所以从
  //    组装里读不到当轮输入。pre-step 的 `decision.messages` 拿得到刚认领的消息，
  //    第一方 dsh-time-context / dsh-agent-instructions 也是在这里补消息的。
  ctx.on(
    "agent/pre-step",
    async (...args: unknown[]): Promise<PreStepDecisionLike | undefined> => {
      const event = args[0] as PreStepEventLike | undefined;
      const next = args[1] as
        | (() => Promise<PreStepDecisionLike | undefined>)
        | undefined;
      const decision =
        typeof next === "function" ? await next() : undefined;
      if (!decision || decision.kind === "reject") return decision;
      if (event?.signal?.aborted) return decision;
      try {
        const text = await engine.remind(event?.agent, decision.messages);
        if (!text) return decision;
        return {
          ...decision,
          messages: [...(decision.messages ?? []), snapshotMessage(text)],
        };
      } catch (error) {
        ctx.logger?.warn?.("simple-memory 关键词提醒失败：%o", error);
        return decision;
      }
    },
  );

  // ④ 命令是只读的：配置住在 profile 的 cordis.patch.yml 里，命令不代写文件。
  ctx.inject(["commands"], (scope) => {
    if (scope.commands) registerMemoryCommand(scope.commands, engine);
  });
}

/**
 * 造一条与官方运行时上下文快照同形的 user 消息：`form: "snapshot"` + `sections`。
 * 这里不 import `@deepseek-ai/dsh-llm`（宿主里没有可解析的安装），但它的
 * `createUserMessage` 只是 `{...input, role: "user", id: randomUUID()}`。
 */
function snapshotMessage(text: string): MessageLike {
  return {
    id: randomUUID(),
    role: "user",
    content: [{ type: "text", text }],
    source: {
      kind: CONTEXT_NAME,
      form: "snapshot",
      sections: [{ name: CONTEXT_NAME, text }],
    },
  };
}
