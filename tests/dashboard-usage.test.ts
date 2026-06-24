import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  accountUsageSnapshotFromEnvelope,
  aggregateAccountUsageRows,
  codexSubscriptionBudget,
  estimateJobCodexCost,
  extractStreamTokenUsage,
  normalizeAccountUsageSnapshot
} from "../dashboard/functions/_shared/usage.js";

describe("dashboard account usage helpers", () => {
  it("normalizes app-server primary and secondary rate-limit windows", () => {
    const snapshot = normalizeAccountUsageSnapshot({
      type: "account/rateLimits/updated",
      collectedAt: "2026-06-18T08:00:00.000Z",
      rateLimits: {
        primary: {
          durationMinutes: 300,
          remaining: 4100,
          limit: 10000,
          resetAt: "2026-06-18T13:00:00.000Z"
        },
        secondary: {
          durationMinutes: 10080,
          remaining: 72000,
          limit: 100000,
          resetAt: "2026-06-22T00:00:00.000Z"
        }
      }
    });

    expect(snapshot?.rolling5hRemaining?.remainingTokens).toBe(4100);
    expect(snapshot?.rolling5hRemaining?.usedPercent).toBe(59);
    expect(snapshot?.weeklyRemaining?.remainingTokens).toBe(72000);
    expect(snapshot?.weeklyRemaining?.usedPercent).toBe(28);
    expect(snapshot?.reset.rolling5hResetAt).toBe("2026-06-18T13:00:00.000Z");
    expect(snapshot?.reset.weeklyResetAt).toBe("2026-06-22T00:00:00.000Z");
  });

  it("extracts real Codex JSONL token_count usage and rate limits", () => {
    const line = JSON.stringify({
      timestamp: "2026-06-18T12:00:00.000Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 1000,
            cached_input_tokens: 800,
            output_tokens: 200,
            reasoning_output_tokens: 25,
            total_tokens: 1200
          }
        },
        rate_limits: {
          primary: { used_percent: 40, window_minutes: 300, resets_at: Date.parse("2026-06-18T17:00:00.000Z") / 1000 },
          secondary: { used_percent: 25, window_minutes: 10080, resets_at: Date.parse("2026-06-22T00:00:00.000Z") / 1000 }
        }
      }
    });
    const payload = { codexJsonl: { lines: [line] } };

    const usage = extractStreamTokenUsage({}, payload);
    const account = accountUsageSnapshotFromEnvelope({
      generatedAt: "2026-06-18T12:00:00.000Z",
      payload
    });

    expect(usage.totalTokens).toBe(1200);
    expect(account?.rolling5hRemaining?.percentRemaining).toBe(60);
    expect(account?.weeklyRemaining?.percentRemaining).toBe(75);
    expect(account?.reset.rolling5hResetAt).toBe("2026-06-18T17:00:00.000Z");
    expect(account?.rolling5hRemaining?.resetAt).toBe("2026-06-18T17:00:00.000Z");
  });

  it("does not double count duplicated token usage snapshots from one raw payload", () => {
    const usage = extractStreamTokenUsage({}, {
      codexJsonl: {
        tokenUsage: { inputTokens: 200, outputTokens: 145, totalTokens: 345 }
      },
      events: [
        {
          type: "thread/tokenUsage/updated",
          usage: { inputTokens: 200, outputTokens: 145, totalTokens: 345 }
        }
      ]
    });

    expect(usage.totalTokens).toBe(345);
  });

  it("calculates burn rates from multiple cumulative snapshots", () => {
    const aggregate = aggregateAccountUsageRows([
      row("2026-06-18T07:00:00.000Z", 10_000, 90_000, 100_000),
      row("2026-06-18T07:30:00.000Z", 16_000, 84_000, 100_000),
      row("2026-06-18T08:00:00.000Z", 22_000, 78_000, 100_000)
    ], {
      now: Date.parse("2026-06-18T08:00:00.000Z")
    });

    expect(aggregate.weekly?.remainingTokens).toBe(78_000);
    expect(aggregate.weekly?.usedPercent).toBe(22);
    expect(aggregate.burn.lastHour.tokens).toBe(12_000);
    expect(aggregate.burn.lastHour.tokensPerHour).toBe(12_000);
    expect(aggregate.burn.week.method).toBe("measured");
  });

  it("reports unknown burn when there is not enough snapshot history", () => {
    const aggregate = aggregateAccountUsageRows([row("2026-06-18T08:00:00.000Z", 10_000, 90_000, 100_000)], {
      now: Date.parse("2026-06-18T08:00:00.000Z")
    });

    expect(aggregate.burn.lastHour.tokens).toBeNull();
    expect(aggregate.burn.lastHour.method).toBe("unknown");
    expect(aggregate.missingReason).toBeNull();
  });

  it("uses the documented Codex subscription default and env override", () => {
    const defaultBudget = codexSubscriptionBudget();
    const overrideBudget = codexSubscriptionBudget({ AGENT_RUNNER_CODEX_SUBSCRIPTION_USD: "200" });

    expect(defaultBudget.monthlyUsd).toBe(100);
    expect(defaultBudget.priceMethod).toBe("estimated");
    expect(defaultBudget.weeklyBudgetUsd).toBeCloseTo(23.0769, 4);
    expect(defaultBudget.formula).toBe("$100.00 monthly / 4.33 = $23.08 weekly");
    expect(overrideBudget.monthlyUsd).toBe(200);
    expect(overrideBudget.priceMethod).toBe("measured");
  });

  it("estimates per-job Codex cost from measured tokens first", () => {
    const cost = estimateJobCodexCost({
      tokenUsage: { inputTokens: 600, outputTokens: 400, totalTokens: 1000 },
      env: {
        AGENT_RUNNER_CODEX_SUBSCRIPTION_USD: "100",
        AGENT_RUNNER_CODEX_WEEKLY_TOKEN_ALLOWANCE: "100000"
      }
    });

    expect(cost.codexCostMethod).toBe("measured");
    expect(cost.tokenUsageMethod).toBe("measured");
    expect(cost.codexCostSource).toBe("job_token_usage");
    expect(cost.codexCostUsd).toBeCloseTo(0.2308, 4);
  });

  it("falls back to quota-delta allocation before runtime allocation", () => {
    const cost = estimateJobCodexCost({
      tokenUsage: { totalTokens: 0 },
      accountUsage: {
        snapshots: [
          {
            collectedAt: "2026-06-18T07:00:00.000Z",
            weeklyRemaining: { remainingTokens: 90_000, limitTokens: 100_000 }
          },
          {
            collectedAt: "2026-06-18T08:00:00.000Z",
            weeklyRemaining: { remainingTokens: 87_500, limitTokens: 100_000 }
          }
        ]
      },
      env: { AGENT_RUNNER_CODEX_SUBSCRIPTION_USD: "100" },
      startedAt: "2026-06-18T07:00:00.000Z",
      finishedAt: "2026-06-18T08:00:00.000Z"
    });

    expect(cost.codexCostMethod).toBe("allocated");
    expect(cost.tokenUsageMethod).toBe("allocated");
    expect(cost.codexCostSource).toBe("quota_delta");
    expect(cost.codexTokens).toBe(2500);
  });

  it("renders usage instrument language without cost confidence labels", () => {
    const app = fs.readFileSync("dashboard/public/app.js", "utf8");

    expect(app).toContain("Codex allowance");
    expect(app).toContain("Token pulse");
    expect(app).toContain("Selected job cost");
    expect(app).toContain("No data yet");
    expect(app).not.toContain("codexAllocationConfidence");
  });
});

function row(collectedAt: string, totalTokens: number, weeklyRemaining: number, weeklyLimit: number) {
  return {
    id: `usage:${collectedAt}`,
    source_id: "source",
    collected_at: collectedAt,
    weekly_remaining_json: JSON.stringify({ remainingTokens: weeklyRemaining, limitTokens: weeklyLimit }),
    rolling_5h_remaining_json: JSON.stringify({ remainingTokens: 4000, limitTokens: 10000 }),
    token_usage_json: JSON.stringify({ totalTokens }),
    reset_json: JSON.stringify({
      weeklyResetAt: "2026-06-22T00:00:00.000Z",
      rolling5hResetAt: "2026-06-18T13:00:00.000Z"
    }),
    metadata_json: "{}"
  };
}
