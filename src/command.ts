import type {
  CommandInvocationLike,
  CommandResultLike,
  CommandsLike,
} from "./dsh.ts";
import type { MemoryEngine } from "./engine.ts";

const HELP = [
  "simple-memory：把 Markdown 记忆目录接入 DSH。",
  "",
  "用法：",
  "  /memory            查看目录、来源与注入统计",
  "  /memory preview    查看本轮的注入文本与未注入来源",
  "  /memory help       显示这段说明",
  "",
  "记忆目录、项目来源与上限都在 profile 的 cordis.patch.yml 里配置；",
  "命令是只读的，不修改配置。",
].join("\n");

export function registerMemoryCommand(
  commands: CommandsLike,
  engine: MemoryEngine,
): void {
  commands.register({
    name: "memory",
    description: "查看 Markdown 记忆的注入内容与状态",
    input: { hint: "[preview|help]" },
    handler: (invocation: CommandInvocationLike): CommandResultLike => {
      const input = (invocation.rawInput ?? "").trim();
      const sub = input.split(/\s+/)[0] || "status";
      const agent = invocation.agent;
      if (sub === "help") return ok(HELP);
      if (sub === "preview") return ok(engine.preview(agent));
      if (sub !== "status")
        return {
          kind: "error",
          text: `未知子命令：${sub}\n\n${HELP}`,
        };
      return ok(status(engine, agent));
    },
  });
}

function ok(text: string): CommandResultLike {
  return { kind: "success", text };
}

function status(engine: MemoryEngine, agent: CommandInvocationLike["agent"]): string {
  const status = engine.status(agent);
  const injected = status.sources.filter((source) => !source.skipped);
  const lines = [
    "# simple-memory",
    "",
    `记忆目录：${status.directory ?? "未配置全局来源"}`,
    `来源：${status.sources.length} 个（本轮注入 ${injected.length} 个）`,
    `本轮注入：${(status.bytes / 1024).toFixed(1)} KiB${
      status.injected ? "" : "（当前无可注入内容）"
    }`,
    `关键词索引：${status.indexed} 篇；待提醒：${status.reminders} 条`,
  ];
  if (!status.sources.length)
    lines.push(
      "",
      "还没有扫到任何来源。若记忆放在项目内，请确认工作目录下有 .memory 目录。",
    );
  const skipped = status.sources.filter((source) => source.skipped);
  if (skipped.length)
    lines.push(
      "",
      "## 未注入来源",
      ...skipped.map(
        (source) =>
          `- ${source.kind === "global" ? "全局" : "项目"} ${source.path}：${source.skipped}`,
      ),
    );
  if (status.issues.length)
    lines.push(
      "",
      "## 提醒",
      ...status.issues.slice(0, 20).map((issue) => `- ${issue}`),
    );
  return lines.join("\n");
}
