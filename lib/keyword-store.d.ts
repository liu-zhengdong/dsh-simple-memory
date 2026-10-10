import { KeywordIndex } from "./keywords.ts";
import type { Snapshot } from "./memory.ts";
/** Per-source caches outlive conversations; the public index is a request snapshot. */
export declare class KeywordStore {
    readonly index: KeywordIndex;
    private sources;
    private retiring;
    private selected;
    private fallback?;
    private stopped;
    private publishedKey;
    private publishGeneration;
    refreshes: number;
    private cacheDirectory;
    constructor(cacheDirectory: string);
    /** Fast selection only. All recursive I/O runs in background, never on submit. */
    prepare(snapshot: Snapshot): void;
    reset(): void;
    get stats(): {
        refreshes: number;
        reads: number;
        cacheHits: number;
    };
    get pending(): boolean;
    private observe;
    private cachePath;
    private load;
    private launch;
    private refresh;
    private save;
    /** First request waits here (after the user's message is visible), only if needed.
     * Later tool continuations retain this same immutable request index. */
    publish(): Promise<void>;
    private retire;
    close(): Promise<void>;
}
