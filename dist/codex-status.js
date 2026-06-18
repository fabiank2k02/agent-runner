import os from "node:os";
import { execa } from "execa";
export function parseCodexStatusOutput(output, collectedAt = new Date().toISOString()) {
    const text = output.trim();
    if (!text) {
        return null;
    }
    const parsed = parseJson(text);
    if (parsed && typeof parsed === "object") {
        return normalizeJsonStatus(parsed, collectedAt);
    }
    return normalizeTextStatus(text, collectedAt);
}
export async function collectCodexAccountUsageSnapshot(options = {}) {
    const timeoutMs = options.timeoutMs ?? 5000;
    const collectedAt = new Date().toISOString();
    try {
        const result = await execa("codex", ["status", "--json"], {
            reject: false,
            timeout: timeoutMs,
            env: process.env
        });
        if (result.exitCode === 0) {
            return parseCodexStatusOutput(result.stdout, collectedAt);
        }
    }
    catch {
        // Fall back to plain text status.
    }
    try {
        const result = await execa("codex", ["status"], {
            reject: false,
            timeout: timeoutMs,
            env: process.env
        });
        if (result.exitCode === 0) {
            return parseCodexStatusOutput(result.stdout, collectedAt);
        }
    }
    catch {
        return null;
    }
    return null;
}
function normalizeJsonStatus(value, collectedAt) {
    const usage = objectAt(value, "usage") || objectAt(value, "tokenUsage") || objectAt(value, "token_usage") || {};
    const limits = objectAt(value, "limits") || {};
    const weekly = objectAt(value, "weeklyRemaining") ||
        objectAt(value, "weekly_remaining") ||
        objectAt(limits, "weekly") ||
        objectAt(limits, "weeklyRemaining") ||
        null;
    const rolling = objectAt(value, "rolling5hRemaining") ||
        objectAt(value, "rolling_5h_remaining") ||
        objectAt(value, "rollingFiveHourRemaining") ||
        objectAt(limits, "rolling5h") ||
        objectAt(limits, "rolling_5h") ||
        null;
    return {
        collectedAt: stringAt(value, "collectedAt") || stringAt(value, "collected_at") || collectedAt,
        weeklyRemaining: normalizeRemaining(weekly),
        rolling5hRemaining: normalizeRemaining(rolling),
        tokenUsage: normalizeTokenUsage(usage),
        reset: normalizeReset(value, limits),
        tierLabel: stringAt(value, "tierLabel") || stringAt(value, "tier_label") || stringAt(value, "accountTier") || null,
        modelUsage: value.modelUsage ?? value.model_usage ?? null,
        sourceEnvironment: sourceEnvironment(),
        rawStatusFormat: "json"
    };
}
function normalizeTextStatus(text, collectedAt) {
    const weekly = matchRemaining(text, /weekly[^\n:]*[:\s]+([0-9][0-9,._]*)\s*(?:\/\s*([0-9][0-9,._]*))?/iu);
    const rolling = matchRemaining(text, /(?:5\s*hour|5h|rolling)[^\n:]*[:\s]+([0-9][0-9,._]*)\s*(?:\/\s*([0-9][0-9,._]*))?/iu);
    const percentWeekly = matchPercent(text, /weekly[^\n]*?([0-9]+(?:\.[0-9]+)?)\s*%\s*(?:remaining|left)/iu);
    const percentRolling = matchPercent(text, /(?:5\s*hour|5h|rolling)[^\n]*?([0-9]+(?:\.[0-9]+)?)\s*%\s*(?:remaining|left)/iu);
    const tokensToday = matchNumber(text, /tokens\s+(?:today|used\s+today)[^\n:]*[:\s]+([0-9][0-9,._]*)/iu);
    const tokensWeek = matchNumber(text, /tokens\s+(?:this\s+week|used\s+this\s+week)[^\n:]*[:\s]+([0-9][0-9,._]*)/iu);
    const tier = text.match(/(?:tier|plan|account)[^\n:]*:\s*([^\n]+)/iu)?.[1]?.trim();
    if (!weekly && !rolling && !tokensToday && !tokensWeek && !tier) {
        return null;
    }
    if (weekly && percentWeekly !== null) {
        weekly.percentRemaining = percentWeekly;
    }
    if (rolling && percentRolling !== null) {
        rolling.percentRemaining = percentRolling;
    }
    return {
        collectedAt,
        weeklyRemaining: weekly,
        rolling5hRemaining: rolling,
        tokenUsage: {
            totalTokens: tokensWeek ?? tokensToday ?? 0,
            tokens: tokensToday ?? tokensWeek ?? 0
        },
        reset: {
            weeklyResetAt: text.match(/weekly[^\n]*reset[^\n:]*:\s*([^\n]+)/iu)?.[1]?.trim() || null,
            rolling5hResetAt: text.match(/(?:5\s*hour|5h|rolling)[^\n]*reset[^\n:]*:\s*([^\n]+)/iu)?.[1]?.trim() || null
        },
        tierLabel: tier || null,
        modelUsage: null,
        sourceEnvironment: sourceEnvironment(),
        rawStatusFormat: "text"
    };
}
function normalizeRemaining(value) {
    if (!value) {
        return null;
    }
    const remaining = numberAt(value, "remainingTokens") ??
        numberAt(value, "remaining_tokens") ??
        numberAt(value, "remaining") ??
        numberAt(value, "left");
    const limit = numberAt(value, "limitTokens") ?? numberAt(value, "limit_tokens") ?? numberAt(value, "limit") ?? numberAt(value, "total");
    const percentRemaining = numberAt(value, "percentRemaining") ??
        numberAt(value, "percent_remaining") ??
        (remaining !== null && limit ? (remaining / limit) * 100 : null);
    return {
        ...value,
        remainingTokens: remaining,
        limitTokens: limit,
        percentRemaining
    };
}
function normalizeTokenUsage(value) {
    const inputTokens = numberAt(value, "inputTokens") ?? numberAt(value, "input_tokens") ?? 0;
    const cachedInputTokens = numberAt(value, "cachedInputTokens") ?? numberAt(value, "cached_input_tokens") ?? 0;
    const outputTokens = numberAt(value, "outputTokens") ?? numberAt(value, "output_tokens") ?? 0;
    const reasoningOutputTokens = numberAt(value, "reasoningOutputTokens") ?? numberAt(value, "reasoning_output_tokens") ?? 0;
    const totalTokens = numberAt(value, "totalTokens") ?? numberAt(value, "total_tokens") ?? numberAt(value, "tokens") ?? inputTokens + outputTokens;
    return {
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningOutputTokens,
        totalTokens,
        tokens: numberAt(value, "tokens") ?? totalTokens
    };
}
function normalizeReset(value, limits) {
    return {
        weeklyResetAt: stringAt(value, "weeklyResetAt") ||
            stringAt(value, "weekly_reset_at") ||
            stringAt(limits, "weeklyResetAt") ||
            stringAt(limits, "weekly_reset_at") ||
            null,
        rolling5hResetAt: stringAt(value, "rolling5hResetAt") ||
            stringAt(value, "rolling_5h_reset_at") ||
            stringAt(limits, "rolling5hResetAt") ||
            stringAt(limits, "rolling_5h_reset_at") ||
            null
    };
}
function matchRemaining(text, pattern) {
    const match = text.match(pattern);
    if (!match) {
        return null;
    }
    const remaining = numberFromText(match[1]);
    const limit = numberFromText(match[2]);
    return {
        remainingTokens: remaining,
        limitTokens: limit,
        percentRemaining: remaining !== null && limit ? (remaining / limit) * 100 : null
    };
}
function matchPercent(text, pattern) {
    const match = text.match(pattern);
    return match ? numberFromText(match[1]) : null;
}
function matchNumber(text, pattern) {
    const match = text.match(pattern);
    return match ? numberFromText(match[1]) : null;
}
function numberFromText(value) {
    if (!value) {
        return null;
    }
    const numeric = Number(value.replace(/[,_]/gu, ""));
    return Number.isFinite(numeric) ? numeric : null;
}
function numberAt(value, key) {
    const numeric = Number(value[key]);
    return Number.isFinite(numeric) ? numeric : null;
}
function stringAt(value, key) {
    return typeof value[key] === "string" && value[key] ? String(value[key]) : null;
}
function objectAt(value, key) {
    const item = value[key];
    return item && typeof item === "object" && !Array.isArray(item) ? item : null;
}
function parseJson(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
}
function sourceEnvironment() {
    return process.env.CODESPACE_NAME || os.hostname();
}
//# sourceMappingURL=codex-status.js.map