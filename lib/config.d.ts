export declare const DEFAULT_MAX_CONTEXT_BYTES: number;
export interface MemoryConfig {
    directory: string | null;
    maxContextBytes: number;
}
/**
 * cosmokit 的 volatile 引用：schemastery `.volatile()` 字段的运行时形状。
 *
 * 宿主把这类字段包成一个只有 `get()` 的冻结对象，桌面端设置界面就地把引用换成新值
 * （插件不重挂载）；写入口 `Symbol.for("cosmokit.volatile.write")` 归宿主独占。
 */
export interface VolatileField<T> {
    get(): T;
}
/**
 * 读一个可能被 `.volatile()` 包裹的配置字段。
 *
 * 必须每次用到时现读：volatile 引用是对象，当作普通值用不会报错，只会静默拿到
 * `undefined`（`typeof directory === "string"` 恒假）。
 */
export declare function liveValue<T>(field: T | VolatileField<T>): T;
/** Unconfigured global memories live next to memory.json: `<agentDir>/memory`. */
export declare function defaultMemoryDirectory(configPath: string): string;
export declare function errorMessage(error: unknown): string;
export declare function cleanPath(input: string, cwd: string): string;
export declare function validateDirectory(input: string, cwd: string): Promise<string>;
export declare function loadConfig(path: string): Promise<MemoryConfig>;
/** Atomic replacement; a bad config is never silently overwritten by a command. */
export declare function saveDirectory(path: string, directory: string | null): Promise<void>;
