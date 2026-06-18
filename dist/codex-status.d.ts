export interface CodexAccountUsageSnapshot {
    collectedAt: string;
    weeklyRemaining?: Record<string, unknown> | null;
    rolling5hRemaining?: Record<string, unknown> | null;
    tokenUsage: {
        inputTokens?: number;
        cachedInputTokens?: number;
        outputTokens?: number;
        reasoningOutputTokens?: number;
        totalTokens?: number;
        tokens?: number;
    };
    reset: Record<string, unknown>;
    tierLabel?: string | null;
    modelUsage?: unknown;
    sourceEnvironment: string;
    rawStatusFormat: "json" | "text";
}
export declare function parseCodexStatusOutput(output: string, collectedAt?: string): CodexAccountUsageSnapshot | null;
export declare function collectCodexAccountUsageSnapshot(options?: {
    timeoutMs?: number;
}): Promise<CodexAccountUsageSnapshot | null>;
