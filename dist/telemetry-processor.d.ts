import type { CommandContext } from "./context.js";
export interface ProcessorClientResult {
    ok: boolean;
    status?: string;
    [key: string]: unknown;
}
export interface ProcessorLocalState {
    version: 1;
    projectSlug: string;
    pid?: number;
    startedAt?: string;
    updatedAt: string;
    lastProcessAt?: string;
    lastError?: string;
}
export interface ProcessorServiceStartResult {
    started: boolean;
    pid?: number;
    statePath: string;
    logPath: string;
    message: string;
}
export interface ProcessorServiceStopResult {
    stopped: boolean;
    pid?: number;
    statePath: string;
    message: string;
}
export interface ProcessorStatusResult {
    local: {
        statePath: string;
        exists: boolean;
        running: boolean;
        pid?: number;
        startedAt?: string;
        lastProcessAt?: string;
        lastError?: string;
        updatedAt?: string;
    };
    remote: unknown;
}
export declare function dashboardProcessorUrl(endpoint: string): string;
export declare function processTelemetryOnce(context: CommandContext, options?: {
    rebuild?: boolean;
    scope?: Record<string, unknown>;
    limits?: Record<string, unknown>;
}): Promise<ProcessorClientResult>;
export declare function rebuildTelemetryProcessing(context: CommandContext, scope: Record<string, unknown>): Promise<ProcessorClientResult>;
export declare function wakeTelemetryProcessor(context: CommandContext, reason?: string): Promise<ProcessorClientResult | null>;
export declare function processorRemoteStatus(context: CommandContext): Promise<unknown>;
export declare function processorStatus(context: CommandContext): Promise<ProcessorStatusResult>;
export declare function startProcessorService(context: CommandContext): Promise<ProcessorServiceStartResult>;
export declare function stopProcessorService(context: CommandContext): Promise<ProcessorServiceStopResult>;
export declare function runProcessorService(context: CommandContext): Promise<void>;
