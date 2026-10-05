/**
 * 注入文本的收尾处理。
 *
 * DSH 的提示词组装会对每个 context 段调用插值：文本里任何完整的 `{{…}}` 都会被
 * 当作提示变量引用，未注册的名字、畸形分组或值为 undefined 都会让整次组装抛错，
 * 使该轮请求失败。记忆正文是用户自己维护的 Markdown，可能自带模板语法（例如
 * Handlebars 片段），所以注入前把 `{{` 拆成 `{<零宽空格>{`：可见文本不变，变量
 * 扫描不会再命中。
 */
export const TEMPLATE_OPEN = "{\u200b{";

export function escapeTemplateBraces(text: string): string {
  return text.includes("{{") ? text.split("{{").join(TEMPLATE_OPEN) : text;
}

/** 按给定顺序拼接非空块，块间空一行。 */
export function joinBlocks(blocks: readonly (string | undefined)[]): string {
  return blocks
    .map((block) => block?.trim())
    .filter((block): block is string => Boolean(block))
    .join("\n\n");
}
