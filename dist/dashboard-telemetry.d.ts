export type LiveEventType = "agent_message" | "command_started" | "command_finished" | "file_read" | "file_edited" | "file_created" | "file_deleted" | "patch_applied" | "tool_call" | "error" | "status_changed";
export type Confidence = "low" | "medium" | "high";
export type Severity = "info" | "success" | "warning" | "error";
export type GoalState = "not_started" | "active" | "complete" | "blocked" | "unknown";
export interface LiveEvent {
    id: string;
    timestamp: string | null;
    type: LiveEventType;
    label: string;
    detail?: string;
    severity: Severity;
    status?: string;
    filePath?: string;
    command?: {
        text?: string;
        exitCode?: number | null;
    };
    tool?: {
        name?: string;
    };
    inferred?: boolean;
    confidence: Confidence;
    source: string;
}
export interface FileActivity {
    path: string;
    latestAction: "read" | "edited" | "created" | "deleted" | "patched";
    readCount: number;
    editCount: number;
    createCount: number;
    deleteCount: number;
    patchCount: number;
    lastSeenAt: string | null;
    confidence: Confidence;
    source: string;
}
export interface TokenUsage {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    reasoningOutputTokens: number;
    totalTokens: number;
}
export interface SpendInputs {
    usage: TokenUsage;
    startedAt?: string | null;
    finishedAt?: string | null;
    now?: number;
    costs?: {
        digitalOceanHourlyUsd?: number;
        codexSubscriptionMonthlyUsd?: number;
        codexSubscriptionSeatMultiplier?: number;
        codexSubscriptionMonthlyTokens?: number;
        codexWeeklyTokenAllowance?: number;
        codexObservedWeeklyTokens?: number;
    };
}
export interface SpendEstimate extends TokenUsage {
    elapsedMinutes: number | null;
    digitalOceanHourlyUsd: number | null;
    digitalOceanCostUsd: number | null;
    digitalOceanConfidence: string;
    codexSubscriptionMonthlyUsd: number | null;
    codexSubscriptionSeatMultiplier: number;
    codexWeeklyBudgetUsd: number | null;
    codexSubscriptionMonthlyTokens: number | null;
    codexWeeklyTokenAllowance: number | null;
    codexObservedWeeklyTokens: number | null;
    codexTaskAllocationUsd: number | null;
    codexTokenCostUsd: number | null;
    codexTaskAllocationPercent: number | null;
    codexRemainingWeeklyBudgetUsd: number | null;
    codexAllocationConfidence: string;
    codexAllocationSource: string;
    totalOperationalCostUsd: number | null;
    totalEstimatedCostUsd: number | null;
    confidence: string;
}
export interface GoalSummary {
    id: string;
    label: string;
    state: GoalState;
    confidence: Confidence;
    source: string;
}
export interface SubgoalSummary extends GoalSummary {
    parentId?: string;
}
export declare function extractLiveEvents(logText: string, options?: {
    limit?: number;
}): LiveEvent[];
export declare function aggregateFileActivity(events: LiveEvent[], limit?: number): FileActivity[];
export declare function extractTokenUsage(logText: string): TokenUsage;
export declare function calculateSubscriptionSpend(input: SpendInputs): SpendEstimate;
export declare function deriveGoalsFromPrompt(prompt: string, limit?: number): GoalSummary[];
export declare function deriveSubgoalsFromEvents(events: LiveEvent[], limit?: number): SubgoalSummary[];
export declare function currentActivityFromEvents(events: LiveEvent[], fallback?: string): string;
export declare function telemetryRuntimeSource(): string;
