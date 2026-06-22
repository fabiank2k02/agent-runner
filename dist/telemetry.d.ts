import type { CommandContext } from "./context.js";
export declare const telemetryStateVersion = 1;
export declare const defaultLocalTelemetryIntervalSeconds: number;
export declare const maxRawPayloadBytes: number;
export declare const maxInlineJsonBytes: number;
export declare const maxLogLinesPerChunk = 500;
export declare const maxCommandOutputSnippetBytes: number;
export declare const maxPromptBytes: number;
export declare const redactedSecretMarker = "[REDACTED_SECRET]";
export type TelemetrySourceKind = "runner-job" | "codespace-worker" | "codex-cli-thread" | "codex-ide-thread" | "local-workspace";
export type TelemetryStreamKind = "runner-job" | "codex-thread" | "workspace";
export interface Cursor {
    [key: string]: unknown;
}
export interface DiscoveredStream {
    id: string;
    kind: TelemetryStreamKind;
    sourceKind: TelemetrySourceKind;
    title?: string;
    filePath?: string;
    metadata?: Record<string, unknown>;
}
export interface TelemetryDelta {
    generatedAt?: string;
    cursor: Cursor;
    metadata?: Record<string, unknown>;
    payload: Record<string, unknown>;
    isEmpty?: boolean;
}
export interface TelemetrySourceAdapter {
    kind: TelemetrySourceKind;
    discover(): Promise<DiscoveredStream[]>;
    readDelta(stream: DiscoveredStream, cursor: Cursor | undefined): Promise<TelemetryDelta>;
}
export interface RawTelemetryEnvelope {
    version: 1;
    kind: "raw-telemetry";
    sourceKind: TelemetrySourceKind;
    sourceId: string;
    streamKind: TelemetryStreamKind;
    projectSlug: string;
    streamId: string;
    sequence: number;
    generatedAt: string;
    cursor: Cursor;
    metadata: Record<string, unknown>;
    payload: Record<string, unknown>;
    truncated?: boolean;
    truncationReason?: string;
}
export declare class TelemetryIngestError extends Error {
    readonly status: number;
    readonly body: {
        error?: string;
        conflict?: boolean;
        latestSequence?: number;
    } | undefined;
    constructor(message: string, status: number, body: {
        error?: string;
        conflict?: boolean;
        latestSequence?: number;
    } | undefined);
}
export interface LocalTelemetryStreamState {
    sequence: number;
    cursor?: Cursor;
    lastHash?: string;
    lastUploadedAt?: string;
    title?: string;
    sourceKind?: TelemetrySourceKind;
    streamKind?: TelemetryStreamKind;
}
export interface LocalTelemetryState {
    version: 1;
    projectSlug: string;
    lastUploadTime?: string;
    lastStreamSequence: number;
    knownStreams: string[];
    streams: Record<string, LocalTelemetryStreamState>;
    lastUploadedChunkHashes: Record<string, string>;
    lastGitHead?: string | null;
    pid?: number;
    startedAt?: string;
    updatedAt: string;
}
export interface LocalTelemetryFlushResult {
    ok: boolean;
    statePath: string;
    uploaded: number;
    skipped: number;
    streams: Array<{
        id: string;
        sourceKind: TelemetrySourceKind;
        streamKind: TelemetryStreamKind;
        sequence: number;
        uploaded: boolean;
        reason?: string;
    }>;
}
export interface LocalTelemetryStatus {
    statePath: string;
    exists: boolean;
    running: boolean;
    pid?: number;
    lastUploadTime?: string;
    lastStreamSequence?: number;
    knownStreams?: string[];
    updatedAt?: string;
}
export interface TelemetryServiceStartResult {
    started: boolean;
    pid?: number;
    statePath: string;
    logPath: string;
    message: string;
}
export interface TelemetryServiceStopResult {
    stopped: boolean;
    pid?: number;
    statePath: string;
    message: string;
}
export declare function redactSecrets(input: string): string;
export declare function redactValue<T>(value: T): T;
export declare function sha256Hex(input: string | Buffer): string;
export declare function truncateUtf8(input: string, maxBytes: number): {
    value: string;
    truncated: boolean;
};
export declare function boundRawPayload(payload: Record<string, unknown>): {
    payload: Record<string, unknown>;
    truncated: boolean;
    truncationReason?: string;
};
export declare function makeRawTelemetryEnvelope(input: {
    sourceKind: TelemetrySourceKind;
    sourceId?: string;
    streamKind: TelemetryStreamKind;
    projectSlug: string;
    streamId: string;
    sequence: number;
    generatedAt?: string;
    cursor?: Cursor;
    metadata?: Record<string, unknown>;
    payload?: Record<string, unknown>;
}): RawTelemetryEnvelope;
export declare function localTelemetryStateDir(projectSlug: string): string;
export declare function localTelemetryStatePath(projectSlug: string): string;
export declare function localTelemetryLogPath(projectSlug: string): string;
export declare function readLocalTelemetryState(projectSlug: string, statePath?: string): Promise<LocalTelemetryState>;
export declare function writeLocalTelemetryState(state: LocalTelemetryState, statePath?: string): Promise<void>;
export declare class WorkspaceTelemetryAdapter implements TelemetrySourceAdapter {
    private readonly projectRoot;
    private readonly projectSlug;
    private readonly denyGlobs;
    readonly kind: "local-workspace";
    constructor(projectRoot: string, projectSlug: string, denyGlobs?: string[]);
    discover(): Promise<DiscoveredStream[]>;
    readDelta(_stream: DiscoveredStream, cursor: Cursor | undefined): Promise<TelemetryDelta>;
}
export declare class CodexCliSessionAdapter implements TelemetrySourceAdapter {
    private readonly options;
    readonly kind: "codex-cli-thread";
    constructor(options: {
        codexHome?: string;
        projectRoot: string;
        projectSlug: string;
        denyGlobs?: string[];
    });
    discover(): Promise<DiscoveredStream[]>;
    readDelta(stream: DiscoveredStream, cursor: Cursor | undefined): Promise<TelemetryDelta>;
    private codexHome;
}
export declare class SimulatedIdeThreadAdapter implements TelemetrySourceAdapter {
    private readonly projectSlug;
    private readonly streams;
    readonly kind: "codex-ide-thread";
    constructor(projectSlug: string, streams?: Array<{
        id: string;
        title: string;
        activity: string;
    }>);
    discover(): Promise<DiscoveredStream[]>;
    readDelta(stream: DiscoveredStream, cursor: Cursor | undefined): Promise<TelemetryDelta>;
}
export declare class CodexAccountStatusAdapter implements TelemetrySourceAdapter {
    private readonly projectSlug;
    readonly kind: "local-workspace";
    constructor(projectSlug: string);
    discover(): Promise<DiscoveredStream[]>;
    readDelta(_stream: DiscoveredStream, cursor: Cursor | undefined): Promise<TelemetryDelta>;
}
export declare function createDefaultLocalTelemetryAdapters(context: CommandContext): TelemetrySourceAdapter[];
export declare function flushLocalTelemetry(context: CommandContext, options?: {
    adapters?: TelemetrySourceAdapter[];
    statePath?: string;
    force?: boolean;
    now?: Date;
}): Promise<LocalTelemetryFlushResult>;
export declare function uploadRawTelemetryEnvelope(context: CommandContext, envelope: RawTelemetryEnvelope): Promise<Record<string, unknown>>;
export declare function localTelemetryStatus(context: CommandContext, options?: {
    statePath?: string;
}): Promise<LocalTelemetryStatus>;
export declare function startLocalTelemetryService(context: CommandContext): Promise<TelemetryServiceStartResult>;
export declare function stopLocalTelemetryService(context: CommandContext): Promise<TelemetryServiceStopResult>;
export declare function runLocalTelemetryService(context: CommandContext): Promise<void>;
export declare function isDeniedLocalTelemetryPath(input: string, denyGlobs?: string[]): boolean;
