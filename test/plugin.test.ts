/**
 * 插件接线测试：用假 ctx 锁住三条通道的契约——
 * ① context 段注册（名字/顺序/同步兜底）
 * ② system-prompt/assemble waterfall（异步新鲜内容、同名替换）
 * ③ agent/pre-step（关键词提醒作为一条 user 快照消息追加进本步）
 * 以及 ④ 命令注册。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type {
  AgentLike,
  CommandInvocationLike,

  MessageLike,
  PreStepDecisionLike,
  PreStepEventLike,
  PromptAssemblyLike,
  PromptContextEntryLike,
} from "../src/dsh.ts";
import { apply, CONTEXT_NAME, CONTEXT_ORDER, type Config } from "../src/index.ts";

type Listener = (...args: unknown[]) => Promise<unknown> | unknown;

interface FakeCommand {
  name: string;
  description?: string;
  input?: { hint?: string };
  handler?: (invocation: CommandInvocationLike) => Promise<unknown> | unknown;
}

interface FakeHost {
  ctx: Parameters<typeof apply>[0];
  contexts: PromptContextEntryLike[];
  listeners: Map<string, Listener>;
  commands: FakeCommand[];
  warnings: unknown[];
}

function makeHost(): FakeHost {
  const contexts: PromptContextEntryLike[] = [];
  const listeners = new Map<string, Listener>();
  const commands: FakeCommand[] = [];
  const warnings: unknown[] = [];
  const ctx = {
    systemPrompt: {
      context: (entry: PromptContextEntryLike) => {
        contexts.push(entry);
      },
    },
    on: (event: string, listener: Listener) => {
      listeners.set(event, listener);
    },
    inject: (names: readonly string[], callback: (scope: unknown) => void) => {
      if (names.includes("commands"))
        callback({ commands: { register: (c: FakeCommand) => commands.push(c) } });
    },
    logger: { warn: (...args: unknown[]) => warnings.push(args) },
  };
  return {
    ctx: ctx as unknown as Parameters<typeof apply>[0],
    contexts,
    listeners,
    commands,
    warnings,
  };
}

async function makeCwd(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "dsh-simple-memory-plugin-"));
  await mkdir(join(cwd, ".git"));
  return cwd;
}

async function makeVault(): Promise<string> {
  const vault = await mkdtemp(join(tmpdir(), "dsh-simple-memory-vault-"));
  await writeFile(
    join(vault, "USER.md"),
    ["---", "description: 用户画像", "purpose: 回答前参考", "---", "", "住在中国。"].join("\n"),
  );
  await mkdir(join(vault, "项目"));
  await writeFile(
    join(vault, "项目", "字体.md"),
    [
      "---",
      "keywords:",
      "  - 字体",
      "purpose: 字体栈约定",
      "description: 界面字体怎么选",
      "---",
      "",
      "正文里提到模板片段 {{cwd}} 也不该让组装失败。",
    ].join("\n"),
  );
  return vault;
}

function configFor(vault: string): Config {
  return {
    directory: vault,
    projectSources: true,
    reminders: true,
    maxContextBytes: 256 * 1024,
  } as Config;
}

function fakeAgent(cwd: string): AgentLike {
  const events: { type: string; data: unknown }[] = [];
  return {
    session: {
      header: { cwd },
      surface: { nodes: [] },
      seq: events.length,
      eventAt: (seq: number) => events[seq],
    },
  } as unknown as AgentLike;
}

function claimed(text: string): MessageLike {
  return {
    id: `claim-${text}`,
    role: "user",
    content: [{ type: "text", text }],
    source: { kind: "user" },
  };
}

test("注册一个 order 9000 的 context 段，缓存为空时同步返回空串", async () => {
  const cwd = await makeCwd();
  const vault = await makeVault();
  try {
    const host = makeHost();
    apply(host.ctx, configFor(vault));
    assert.equal(host.contexts.length, 1);
    const entry = host.contexts[0]!;
    assert.equal(entry.name, CONTEXT_NAME);
    assert.equal(entry.order, CONTEXT_ORDER);
    assert.equal(typeof entry.text, "function");
    const agent = fakeAgent(cwd);
    const text = (entry.text as (c: unknown) => string)({ agent });
    assert.equal(text, "");
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test("组装 waterfall 用最新扫描结果替换同名段，只留一段", async () => {
  const cwd = await makeCwd();
  const vault = await makeVault();
  try {
    const host = makeHost();
    apply(host.ctx, configFor(vault));
    const listener = host.listeners.get("system-prompt/assemble");
    assert.ok(listener, "必须监听 system-prompt/assemble");
    const agent = fakeAgent(cwd);
    // 上游（含我们注册的 context 段本身）已经放了一份陈旧文本。
    const stale: PromptAssemblyLike = {
      contexts: [
        { name: "sandbox:policy", order: 110, text: "沙箱策略" },
        { name: CONTEXT_NAME, order: CONTEXT_ORDER, text: "陈旧文本" },
      ],
    };
    const base = await listener!(
      stale,
      { agent },
      () => Promise.resolve(stale),
    );
    const contexts = (base as PromptAssemblyLike).contexts!;
    const ours = contexts.filter((entry) => entry.name === CONTEXT_NAME);
    assert.equal(ours.length, 1, "同名段只能有一段");
    const text = String(ours[0]!.text);
    assert.match(text, /^# 记忆/m);
    assert.ok(text.includes(join(vault, "USER.md")), text);
    assert.ok(!text.includes("陈旧文本"));
    assert.equal(contexts[0]!.name, "sandbox:policy", "其它段保持原样");
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test("pre-step 把命中的关键词提醒作为一条 user 快照消息追加进本步", async () => {
  const cwd = await makeCwd();
  const vault = await makeVault();
  try {
    const host = makeHost();
    apply(host.ctx, configFor(vault));
    const listener = host.listeners.get("agent/pre-step");
    assert.ok(listener, "必须监听 agent/pre-step");
    const agent = fakeAgent(cwd);
    const first = claimed("这个界面的字体想换一下");
    const event: PreStepEventLike = { agent, messages: [first], turn: 1, step: 1 };
    const decision: PreStepDecisionLike = { kind: "enter", messages: [first] };
    const entered = (await listener!(event, () => Promise.resolve(decision))) as PreStepDecisionLike;
    const messages = entered.messages!;
    assert.equal(messages.length, 2);
    const extra = messages[1]!;
    assert.equal(extra.role, "user");
    assert.equal(extra.source?.kind, CONTEXT_NAME);
    assert.equal(extra.source?.form, "snapshot");
    assert.equal(extra.source?.sections?.[0]?.name, CONTEXT_NAME);
    const content = Array.isArray(extra.content) ? extra.content : [];
    const text = content[0]?.text ?? "";
    assert.match(text, /# 关键词提醒/);
    assert.ok(text.includes(join(vault, "项目", "字体.md")), text);
    assert.equal(typeof extra.id, "string");
    assert.notEqual(extra.id, first.id);
    assert.deepEqual(host.warnings, []);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test("没有命中、被拒绝或已中止时都不追加消息", async () => {
  const cwd = await makeCwd();
  const vault = await makeVault();
  try {
    const host = makeHost();
    apply(host.ctx, configFor(vault));
    const listener = host.listeners.get("agent/pre-step")!;
    const agent = fakeAgent(cwd);

    const miss = claimed("完全没有关系的一句话");
    const missDecision: PreStepDecisionLike = { kind: "enter", messages: [miss] };
    const keptMiss = (await listener(
      { agent, messages: [miss] },
      () => Promise.resolve(missDecision),
    )) as PreStepDecisionLike;
    assert.deepEqual(keptMiss.messages, [miss]);

    const hit = claimed("字体");
    const reject = (await listener(
      { agent, messages: [hit] },
      () => Promise.resolve({ kind: "reject", messages: [] }),
    )) as PreStepDecisionLike;
    assert.equal(reject.kind, "reject");

    const aborted = (await listener(
      { agent, messages: [hit], signal: { aborted: true } },
      () => Promise.resolve({ kind: "enter", messages: [hit] } as PreStepDecisionLike),
    )) as PreStepDecisionLike;
    assert.deepEqual(aborted.messages, [hit]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test("注册 /memory 命令：状态、预览、帮助都只读", async () => {
  const cwd = await makeCwd();
  const vault = await makeVault();
  try {
    const host = makeHost();
    apply(host.ctx, configFor(vault));
    assert.equal(host.commands.length, 1);
    const command = host.commands[0]!;
    assert.equal(command.name, "memory");
    assert.ok(command.description);
    assert.ok(command.input?.hint?.includes("preview"));
    const agent = fakeAgent(cwd);
    // 真实宿主里命令总是发生在一次组装之后，那时引擎已经有快照了。
    const assemble = host.listeners.get("system-prompt/assemble")!;
    await assemble({ contexts: [] }, { agent }, () =>
      Promise.resolve({ contexts: [] }),
    );

    const status = (await command.handler!({ rawInput: "", agent })) as {
      kind: string;
      text: string;
    };
    assert.equal(status.kind, "success");
    assert.ok(status.text.includes(vault), status.text);

    const preview = (await command.handler!({ rawInput: "preview", agent })) as {
      kind: string;
      text: string;
    };
    assert.equal(preview.kind, "success");
    assert.match(preview.text, /# 记忆/);

    const help = (await command.handler!({ rawInput: "help", agent })) as {
      kind: string;
      text: string;
    };
    assert.equal(help.kind, "success");
    assert.ok(help.text.includes("/memory"));

    const unknown = (await command.handler!({ rawInput: "bogus", agent })) as {
      kind: string;
    };
    assert.equal(unknown.kind, "error");
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});
