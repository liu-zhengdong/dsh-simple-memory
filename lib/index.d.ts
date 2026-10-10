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
import type { PluginContextLike } from "./dsh.ts";
import { type PluginConfig } from "./engine.ts";
export declare const name = "dsh-simple-memory";
/** 注入要落在提示词组装上，所以声明 systemPrompt 依赖。 */
export declare const inject: string[];
export interface Config extends PluginConfig {
}
/**
 * 每个字段都标 `.volatile()`：只有 volatile 字段会出现在宿主设置服务的 describe
 * 里，桌面端「插件」页与「设置 → 插件」页因此能直接改这些值（写进 profile 的
 * cordis.patch.yml），不必手改 YAML。代价是运行时读到的可能是 volatile 引用而不是
 * 普通值，所以下面一律经过 `liveValue()`。
 */
export declare const Config: Schema<Schemastery.ObjectS<NoInfer<{
    directory: Schema<string, string, "volatile-defined">;
    projectSources: Schema<boolean, boolean, "volatile-defined">;
    reminders: Schema<boolean, boolean, "volatile-defined">;
    maxContextBytes: Schema<number, number, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    directory: Schema<string, string, "volatile-defined">;
    projectSources: Schema<boolean, boolean, "volatile-defined">;
    reminders: Schema<boolean, boolean, "volatile-defined">;
    maxContextBytes: Schema<number, number, "volatile-defined">;
}>>, "plain">;
/** runtime context 段名；注入文本的唯一标识。 */
export declare const CONTEXT_NAME = "simple-memory";
/** 外部贡献可以用任意有限的顺序值；第一方 context 只占 110/115/120。 */
export declare const CONTEXT_ORDER = 9000;
export declare function apply(ctx: PluginContextLike, config: Config): void;
