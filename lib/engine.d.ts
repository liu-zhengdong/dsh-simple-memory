import type { MemoryConfig } from "./config.ts";
import type { AgentLike, MessageLike } from "./dsh.ts";
export interface PluginConfig {
    /** 全局记忆目录；空串表示不配置全局来源。 */
    directory: string;
    /** 是否从工作目录向上发现项目内的 `.memory`。 */
    projectSources: boolean;
    /** 是否启用关键词提醒。 */
    reminders: boolean;
    maxContextBytes: number;
}
/** 把配置里的目录整理成绝对路径；空串表示不配置。 */
export declare function resolveDirectory(input: string): string | null;
export declare function memoryConfig(config: PluginConfig): MemoryConfig;
export interface EngineStatus {
    directory: string | null;
    sources: {
        kind: string;
        path: string;
        notes: number;
        bytes: number;
        skipped?: string;
    }[];
    bytes: number;
    issues: string[];
    reminders: number;
    indexed: number;
    injected: boolean;
}
/** 从消息里取出纯文本；无法识别的形状返回空串。 */
export declare function messageText(message: MessageLike | undefined): string;
export declare class MemoryEngine {
    private readonly loader;
    private readonly states;
    private readonly readConfig;
    constructor(readConfig: () => PluginConfig);
    /**
     * 让缓存立刻反映磁盘，并返回这一刻应该注入的**记忆索引**。
     *
     * 关键词提醒不在这里取：组装期（`system-prompt/assemble`）的会话日志里还没有
     * 本步刚认领的用户消息，取不出命中；提醒统一走 `remind()`。
     */
    refresh(agent: AgentLike | undefined): Promise<string>;
    /** 后台预热：只为同步的 context provider 准备兜底文本。 */
    warm(agent: AgentLike | undefined): void;
    /**
     * 取本步要提供的关键词提醒。
     *
     * `claimed` 是本步刚认领、还没来得及写进会话日志的消息（pre-step 的
     * `decision.messages` 原样带过来），所以必须单独看，否则永远慢一步。
     */
    remind(agent: AgentLike | undefined, claimed?: readonly MessageLike[]): Promise<string>;
    /** 已经算好的注入文本；组装时同步可读。 */
    cached(agent: AgentLike | undefined): string;
    status(agent: AgentLike | undefined): EngineStatus;
    preview(agent: AgentLike | undefined): string;
    /** 会话恢复或压缩后重新对账。 */
    reset(agent: AgentLike | undefined): void;
    private stateFor;
    private update;
    /** 按消息 id 去重后，把一条消息的文本交给关键词匹配。 */
    private captureMessage;
    /**
     * 记录新出现的用户输入与模型文本里的关键词命中。
     *
     * 会话事件按 `session.seq`（已记录事件的条数）枚举：`surface.nodes` 在一步
     * 的组装期还是空的（投影要等这一步提交），靠它读当轮用户输入会晚一步——
     * 第一方 dsh-time-context 也是直接用 `session.seq - 1` 往前扫的。
     */
    private capture;
}
