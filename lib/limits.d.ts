/**
 * 根层默认展开记忆的单篇上限：`defaultopen: true` 的全文每轮都在上下文里，
 * 单篇大小决定最坏的一条成本。这里只做判定与提醒文案；注入文本由 memory.ts 渲染，
 * 保证只有一处生成上下文。
 */
export declare const EXPANDED_FULL_BYTES_LIMIT: number;
/** 单篇超过字节上限时提醒，不阻止注入；顺序与输入一致。 */
export declare function checkExpandedFull(fullText: readonly {
    name: string;
    bytes: number;
}[]): string[];
