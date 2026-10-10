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
    refresh(snapshot: Snapshot, changes?: readonly string[]): Promise<void>;
    match(text: string): string[];
}
