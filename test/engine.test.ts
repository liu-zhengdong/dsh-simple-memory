/**
 * 注入引擎的端到端测试：真目录 + 假 agent，不依赖任何 DSH 宿主。
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AgentLike, MessageLike } from "../src/dsh.ts";
import { MemoryEngine, type PluginConfig } from "../src/engine.ts";

interface FakeAgent {
  agent: AgentLike;
  /** 记进会话日志的用户消息（等价于一步提交之后）。 */
  user(text: string): void;
  assistant(text: string): void;
  /**
   * 本步刚认领、还没写进日志的用户消息——真实宿主里它只出现在
   * `agent/pre-step` 的 `decision.messages` 里。
   */
  claim(text: string): MessageLike;
}

/**
 * 假 agent。默认模拟真实宿主：组装期 `surface.nodes` 还是空的，只有
 * `session.seq` 能枚举到本步刚认领的消息。`surfaceOnly` 用来覆盖退化路径。
 */
function makeAgent(cwd: string, options: { surfaceOnly?: boolean } = {}): FakeAgent {
  const events: { type: string; data: unknown }[] = [];
  const nodes: number[] = [];
  const session: Record<string, unknown> = {
    header: { cwd },
    surface: { nodes },
    eventAt: (seq: number) => events[seq],
  };
  if (!options.surfaceOnly)
    Object.defineProperty(session, "seq", {
      get: () => events.length,
      enumerable: true,
    });
  const push = (type: string, text: string, kind?: string) => {
    events.push({
      type,
      data: { content: [{ type: "text", text }], source: kind ? { kind } : {} },
    });
    if (options.surfaceOnly) nodes.push(events.length - 1);
  };
  let nextId = 0;
  return {
    agent: { session } as unknown as AgentLike,
    user: (text) => push("user/message", text, "user"),
    assistant: (text) => push("assistant/message", text),
    claim: (text) => ({
      id: `claim-${++nextId}`,
      role: "user",
      content: [{ type: "text", text }],
      source: { kind: "user" },
    }),
  };
}

async function makeCwd(): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "dsh-simple-memory-"));
  // `.git` 让向上发现停在临时目录，测试不受机器上其它 .memory 影响。
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

function engineFor(vault: string | null, extra: Partial<PluginConfig> = {}) {
  const config: PluginConfig = {
    directory: vault ?? "",
    projectSources: true,
    reminders: true,
    maxContextBytes: 256 * 1024,
    ...extra,
  };
  return new MemoryEngine(() => config);
}

test("根层记忆以索引形式注入：名称、绝对路径、定位", async () => {
  const cwd = await makeCwd();
  const vault = await makeVault();
  try {
    const { agent } = makeAgent(cwd);
    const text = await engineFor(vault).refresh(agent);
    assert.match(text, /^# 记忆/m);
    assert.ok(text.includes(join(vault, "USER.md")), text);
    assert.ok(text.includes("用户画像"));
    assert.ok(text.includes("回答前参考"));
    assert.ok(!text.includes("住在中国。"), "没有 defaultopen 的记忆不应展开正文");
    assert.ok(text.includes(join(vault, "项目")), "子文件夹作为入口列出");
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test("用户输入命中 keywords 时给出提醒，并带绝对路径", async () => {
  const cwd = await makeCwd();
  const vault = await makeVault();
  try {
    const fake = makeAgent(cwd);
    const engine = engineFor(vault);
    await engine.refresh(fake.agent);
    const claimed = fake.claim("这个界面的字体想换一下");
    const text = await engine.remind(fake.agent, [claimed]);
    assert.match(text, /# 关键词提醒/);
    assert.ok(text.includes(join(vault, "项目", "字体.md")));
    // 已经提醒过的记忆不重复提醒。
    const again = await engine.remind(fake.agent, [claimed]);
    assert.equal(again, "");
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test("会话第一条消息就命中关键词时也要给提醒", async () => {
  const cwd = await makeCwd();
  const vault = await makeVault();
  try {
    const fake = makeAgent(cwd);
    const engine = engineFor(vault);
    const text = await engine.remind(fake.agent, [
      fake.claim("这个界面的字体想换一下"),
    ]);
    assert.match(text, /# 关键词提醒/);
    assert.ok(text.includes(join(vault, "项目", "字体.md")));
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test("预热与组装刷新都不会吞掉提醒", async () => {
  const cwd = await makeCwd();
  const vault = await makeVault();
  try {
    const fake = makeAgent(cwd);
    const engine = engineFor(vault);
    const claimed = fake.claim("这个界面的字体想换一下");
    // 同步的 context provider 会先 warm 一次，随后 waterfall 又 refresh 一次。
    engine.warm(fake.agent);
    await engine.refresh(fake.agent);
    const text = await engine.remind(fake.agent, [claimed]);
    assert.match(text, /# 关键词提醒/);
    // 提醒取走一次就算提供过了，同一步里不会重复给。
    assert.equal(await engine.remind(fake.agent, [claimed]), "");
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test("只有 surface.nodes 可用的宿主也能提醒", async () => {
  const cwd = await makeCwd();
  const vault = await makeVault();
  try {
    const fake = makeAgent(cwd, { surfaceOnly: true });
    // 一步提交之后，这条消息才出现在日志里（下一步或恢复会话时看到）。
    fake.user("这个界面的字体想换一下");
    const text = await engineFor(vault).remind(fake.agent);
    assert.match(text, /# 关键词提醒/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test("模型文本命中留到下一次调用", async () => {
  const cwd = await makeCwd();
  const vault = await makeVault();
  try {
    const fake = makeAgent(cwd);
    const engine = engineFor(vault);
    await engine.refresh(fake.agent);
    fake.assistant("我建议统一字体栈");
    const text = await engine.remind(fake.agent);
    assert.match(text, /# 关键词提醒/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test("注入文本不携带模板括号，组装不会被变量扫描打断", async () => {
  const cwd = await makeCwd();
  const vault = await makeVault();
  try {
    const fake = makeAgent(cwd);
    const text = await engineFor(vault).refresh(fake.agent);
    assert.ok(!text.includes("{{"), text);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test("项目内的 .memory 由工作目录向上发现", async () => {
  const cwd = await makeCwd();
  const nested = join(cwd, "src");
  await mkdir(nested);
  await mkdir(join(cwd, ".memory"));
  await writeFile(
    join(cwd, ".memory", "约定.md"),
    ["---", "purpose: 本仓库约定", "---", "", "提交信息用中文。"].join("\n"),
  );
  try {
    const { agent } = makeAgent(nested);
    const text = await engineFor(null).refresh(agent);
    assert.match(text, /^# 项目记忆/m);
    assert.ok(text.includes(join(cwd, ".memory", "约定.md")));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("关掉 reminders 后不再提供关键词提醒", async () => {
  const cwd = await makeCwd();
  const vault = await makeVault();
  try {
    const fake = makeAgent(cwd);
    const engine = engineFor(vault, { reminders: false });
    await engine.refresh(fake.agent);
    fake.user("字体");
    const text = await engine.refresh(fake.agent);
    assert.ok(!text.includes("# 关键词提醒"));
    assert.match(text, /^# 记忆/m);
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(vault, { recursive: true, force: true });
  }
});

test("空目录与未配置来源时注入空文本", async () => {
  const cwd = await makeCwd();
  try {
    const { agent } = makeAgent(cwd);
    const engine = engineFor(null, { projectSources: false });
    assert.equal(await engine.refresh(agent), "");
    assert.equal(engine.cached(agent), "");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
