/**
 * 关键词提醒的待办与去重状态。
 *
 * 与 Pi 版（pi-memory 的 src/reminders.ts）相比，这里不再接管会话分支的持久化：
 * DSH 侧由适配层在会话事件里调用 `reset()`。本文件只依赖 KeywordIndex 与渲染函数，
 * 不依赖任何宿主 API，便于单独测试。
 *
 * 语义（沿用 pi-memory DESIGN.md「关键词按需提醒」一节）：
 * - 用户输入中的命中：本次请求前提供。
 * - 模型文本（回复或可见思考）中的命中：留到下一次正常调用前提供。
 * - 已提供过的记忆按路径去重；离开上下文（压缩/恢复）后可以重新提醒。
 * - 已在默认注入里出现过的根层记忆不再通过关键词重复提供。
 */
import { KeywordIndex } from "./keywords.ts";
import { type Note, type Snapshot } from "./memory.ts";
export interface Reminder extends Note {
    keywords: string[];
}
export declare class Reminders {
    /** 命中但尚未提供给模型。 */
    private pending;
    /** 已经提供过的记忆路径。 */
    private provided;
    private budget;
    private snapshot?;
    private readonly index;
    constructor(index: KeywordIndex);
    /**
     * 每轮请求开始时配置：记录本轮默认注入的根层记忆（视为已提供），
     * 并清除本轮已不再属于候选范围的路径。
     */
    configure(snapshot: Snapshot | undefined, budget: number): void;
    /** 会话恢复、分支切换与上下文压缩后重新对账。 */
    reset(): void;
    /** 记录一段新的文本（用户输入、模型回复或可见思考）里的关键词命中。 */
    capture(text: string): void;
    get pendingPaths(): string[];
    /**
     * 取出本轮要提供的提醒（按路径稳定排序），并标记为已提供。
     * `used` 是默认注入已占用的字节数；超出剩余预算的整篇延后并计数返回。
     */
    take(used: number): {
        reminders: Reminder[];
        text: string;
        omitted: number;
    };
}
