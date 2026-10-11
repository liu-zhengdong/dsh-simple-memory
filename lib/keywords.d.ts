import { type Note, type Snapshot } from "./memory.ts";
export interface KeywordNote extends Note {
    keywords: string[];
    /** 深层 frontmatter 里的 `defaultopen`：不生效，仅用于提醒。 */
    deepDefaultopen?: true;
}
export declare const MAX_INDEX_BYTES: number;
/** Metadata-only, bounded index. No file I/O occurs while matching a message. */
export declare class KeywordIndex {
    notes: Map<string, KeywordNote>;
    issues: string[];
    reads: number;
    cacheHits: number;
    private cache;
    private cacheBytes;
    clear(): void;
    private remember;
    /** Disk cache contains only bounded, validated metadata. Never accept cached bodies. */
    exportCache(): unknown;
    importCache(data: unknown, directory: string): void;
    /** Reconcile the index against a snapshot.
     *
     * Returns this pass's own I/O counts, which the caller accumulates: the
     * counters are per-pass, so a later cheap pass must not erase the work an
     * earlier one did. `changed` reports whether the published index actually
     * differs — a pass that finds nothing new must not count as a refresh, or
     * every replayed filesystem event would rebuild the match map for nothing. */
    refresh(snapshot: Snapshot, changes?: readonly string[]): Promise<{
        reads: number;
        cacheHits: number;
        changed: boolean;
    }>;
    match(text: string): string[];
}
