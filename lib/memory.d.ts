import { type BigIntStats } from "node:fs";
import { type FileHandle } from "node:fs/promises";
import { type MemoryConfig } from "./config.ts";
export declare const MAX_HEADER_BYTES: number;
export interface Metadata {
    defaultopen: boolean;
    keywords?: string[];
    description?: string;
    purpose?: string;
}
export interface Note {
    name: string;
    path: string;
    description?: string;
    purpose?: string;
    body?: string;
    error?: string;
}
export interface Folder {
    name: string;
    path: string;
}
export type SourceKind = "global" | "project";
/** One note source for this round; `reason` excludes it before scanning. */
export interface SourceRequest {
    kind: SourceKind;
    path: string;
    reason?: string;
}
export interface SourceSnapshot {
    /** Identity of the selected root (following an explicitly configured symlink). */
    identity?: string;
    kind: SourceKind;
    path: string;
    notes: Note[];
    folders: Folder[];
    issues: string[];
    /** Rendered block injected this round; empty when excluded. */
    text: string;
    bytes: number;
    skipped?: string;
}
export interface Snapshot {
    directory: string | null;
    sources: SourceSnapshot[];
    issues: string[];
    text: string;
    bytes: number;
    reads: number;
    cacheHits: number;
}
export interface DiscoveryResult {
    paths: string[];
    issues: string[];
}
export declare const UNTRUSTED_REASON = "\u9879\u76EE\u672A\u53D7 Pi \u4FE1\u4EFB\uFF0C\u672A\u6CE8\u5165\u5176\u4E2D\u7684\u8BB0\u5FC6\u3002";
/** undefined means that a bounded prefix needs more data. Offsets are JS string offsets. */
export declare function headerBounds(text: string, eof: boolean): {
    source: string;
    bodyOffset: number;
} | undefined;
export declare function parseMetadata(source: string): Metadata;
export declare const signature: (stat: BigIntStats) => string;
export declare function renderNote(note: Note): string;
/**
 * Locate `.memory` directories from cwd up to the git root (or filesystem root).
 * Returned shallow to deep; unreadable ancestors stop the ascent silently,
 * but an unreadable cwd is reported.
 */
export declare function discoverMemoryDirectories(cwd: string): Promise<DiscoveryResult>;
/** Global first, project shallow to deep. A nested .memory is not covered by a
 * global ancestor: hidden directories are excluded from ordinary discovery. */
export declare function resolveSources(config: MemoryConfig, discovery: DiscoveryResult, isTrusted: () => boolean): SourceRequest[];
/** /memory preview: injected blocks plus every excluded source with its reason. */
export declare function previewSnapshot(snapshot: Snapshot): string;
export declare function readHeader(file: FileHandle, size: bigint): Promise<ReturnType<typeof parseMetadata>>;
/** Only root entries are discovered. Serialized cache payload is capped at twice the context budget. */
export declare class MemoryLoader {
    private cache;
    private cacheBytes;
    private limit?;
    clear(): void;
    private remember;
    /** Scan one source's direct children. Throws when the source itself is unreadable. */
    private scanEntries;
    /**
     * Sources are ordered by the caller (global first, project shallow to deep).
     * Whole sources exceeding the budget are excluded and reported; no partial
     * note bodies are injected and nothing is silently dropped.
     */
    scan(config: MemoryConfig, sources?: SourceRequest[]): Promise<Snapshot>;
}
