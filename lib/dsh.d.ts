/**
 * DSH 宿主面的最小结构化类型。
 *
 * 这里刻意不 import 任何 `@deepseek-ai/*` 包：那些包只随 DSH 安装分发（app.asar
 * 内），npm 上的版本号与宿主不一致，把它们的类型写进插件会把插件锁死在某个
 * 版本上。插件运行时只需要下面这些成员，宿主多给的字段一律忽略。
 */
export interface ContentBlockLike {
    type?: string;
    text?: string;
}
/** 消息来源。运行时上下文快照用 `form: "snapshot"` + `sections` 标记归属。 */
export interface MessageSourceLike {
    kind?: string;
    form?: string;
    sections?: {
        name?: string;
        text?: string;
    }[];
}
export interface MessageLike {
    id?: string;
    role?: string;
    content?: string | ContentBlockLike[];
    source?: MessageSourceLike;
}
export interface SessionEventLike {
    type?: string;
    data?: MessageLike & Record<string, unknown>;
}
export interface SessionLike {
    header?: {
        cwd?: string;
    };
    /**
     * 已记录事件的条数：合法的 seq 是 `0 .. seq - 1`。
     * 组装期它已经包含本步刚认领的用户消息，而 `surface.nodes` 还没有（投影要等
     * 这一步提交），所以读取当轮输入要用它。
     */
    seq?: number;
    /** 已接纳消息与边界事件的序号列表，按发生顺序排列。 */
    surface?: {
        nodes?: readonly number[];
    };
    eventAt?(seq: number): SessionEventLike | undefined;
}
export interface AgentLike {
    id?: string;
    session?: SessionLike;
}
/** `systemPrompt.assemble()` 的求值上下文；`agent` 由 dsh-agent 补上。 */
export interface AssembleContextLike {
    agent?: AgentLike;
    signal?: AbortSignal;
}
export interface PromptContextEntryLike {
    name: string;
    order?: number;
    text: string | ((context: AssembleContextLike) => string);
}
export interface PromptAssemblyLike {
    contexts?: PromptContextEntryLike[];
    [key: string]: unknown;
}
export interface SystemPromptLike {
    context(entry: PromptContextEntryLike): unknown;
}
export interface CommandInvocationLike {
    rawInput?: string;
    agent?: AgentLike;
    signal?: AbortSignal;
}
export interface CommandResultLike {
    kind: "success" | "error";
    text: string;
}
export interface CommandsLike {
    register(command: {
        name: string;
        description?: string;
        input?: {
            hint?: string;
        };
        handler(invocation: CommandInvocationLike): CommandResultLike | Promise<CommandResultLike>;
    }): unknown;
}
/** `agent/pre-step` 的载荷：本步刚认领的消息在这里，会话日志里还没有。 */
export interface PreStepEventLike {
    agent?: AgentLike;
    messages?: readonly MessageLike[];
    turn?: number;
    step?: number;
    signal?: AbortSignal;
}
/** `agent/pre-step` 的决策：`messages` 就是本步最终要发给模型的消息。 */
export interface PreStepDecisionLike {
    kind?: string;
    messages?: MessageLike[];
    [key: string]: unknown;
}
export interface LoggerLike {
    debug?(...args: unknown[]): void;
    info?(...args: unknown[]): void;
    warn(...args: unknown[]): void;
}
export interface PluginContextLike {
    systemPrompt: SystemPromptLike;
    on(event: string, listener: (...args: never[]) => unknown, options?: {
        prepend?: boolean;
    }): unknown;
    inject(names: readonly string[], callback: (ctx: PluginContextLike) => void): unknown;
    commands?: CommandsLike;
    logger?: LoggerLike;
}
