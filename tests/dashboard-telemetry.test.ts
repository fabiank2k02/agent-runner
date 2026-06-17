import { describe, expect, it } from "vitest";
import {
  aggregateFileActivity,
  calculateSubscriptionSpend,
  deriveGoalsFromPrompt,
  extractLiveEvents,
  extractTokenUsage
} from "../src/dashboard-telemetry.js";

describe("dashboard telemetry helpers", () => {
  it("extracts structured events and file activity from Codex JSONL and patches", () => {
    const log = [
      JSON.stringify({
        type: "item.completed",
        timestamp: "2026-06-17T10:00:00Z",
        item: {
          type: "agent_message",
          text: "I am inspecting the dashboard ingest path."
        }
      }),
      JSON.stringify({
        type: "item.started",
        timestamp: "2026-06-17T10:01:00Z",
        item: {
          type: "command_execution",
          command: "sed -n '1,120p' dashboard/functions/api/ingest.js"
        }
      }),
      JSON.stringify({
        type: "item.completed",
        timestamp: "2026-06-17T10:02:00Z",
        item: {
          type: "tool_call",
          name: "apply_patch",
          arguments: {
            patch: "*** Begin Patch\n*** Update File: dashboard/public/app.js\n*** Add File: dashboard/migrations/0002_live_telemetry.sql\n*** End Patch"
          }
        }
      })
    ].join("\n");

    const events = extractLiveEvents(log);
    const files = aggregateFileActivity(events);

    expect(events.map((event) => event.type)).toContain("agent_message");
    expect(events.map((event) => event.type)).toContain("command_started");
    expect(events.map((event) => event.type)).toContain("file_read");
    expect(events.map((event) => event.type)).toContain("patch_applied");
    expect(events.map((event) => event.type)).toContain("file_created");
    expect(events.every((event) => event.id)).toBe(true);
    expect(files.find((file) => file.path === "dashboard/public/app.js")?.editCount).toBe(1);
    expect(files.find((file) => file.path === "dashboard/migrations/0002_live_telemetry.sql")?.createCount).toBe(1);
  });

  it("extracts token usage and calculates subscription allocation spend", () => {
    const usage = extractTokenUsage(
      JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 1200,
          cached_input_tokens: 300,
          output_tokens: 800,
          reasoning_output_tokens: 200
        }
      })
    );

    const spend = calculateSubscriptionSpend({
      usage,
      startedAt: "2026-06-17T00:00:00Z",
      finishedAt: "2026-06-17T01:00:00Z",
      costs: {
        digitalOceanHourlyUsd: 0.04,
        codexSubscriptionMonthlyUsd: 100,
        codexSubscriptionSeatMultiplier: 5,
        codexWeeklyTokenAllowance: 100000
      }
    });

    expect(usage.totalTokens).toBe(2000);
    expect(spend.codexWeeklyBudgetUsd).toBeCloseTo(115.3846, 4);
    expect(spend.codexTaskAllocationUsd).toBeCloseTo(2.3077, 4);
    expect(spend.digitalOceanCostUsd).toBeCloseTo(0.04, 4);
    expect(spend.totalOperationalCostUsd).toBeCloseTo(2.3477, 4);
    expect(spend.codexAllocationConfidence).toBe("configured");
  });

  it("falls back to runtime allocation when token usage is missing", () => {
    const spend = calculateSubscriptionSpend({
      usage: {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0
      },
      startedAt: "2026-06-17T00:00:00Z",
      finishedAt: "2026-06-17T02:00:00Z",
      costs: {
        codexSubscriptionMonthlyUsd: 100,
        codexSubscriptionSeatMultiplier: 1
      }
    });

    expect(spend.codexTaskAllocationUsd).toBeGreaterThan(0);
    expect(spend.codexAllocationConfidence).toBe("missing_tokens");
    expect(spend.codexAllocationSource).toBe("runtime_allocation");
  });

  it("derives compact top-level goals from required improvements", () => {
    const goals = deriveGoalsFromPrompt(`
## Required Improvements

1. Live Event Extraction
2. One-Minute Live Snapshot
3. Contract Goals And Subgoals

## Validation
Run tests.
`);

    expect(goals.map((goal) => goal.label)).toEqual([
      "Live Event Extraction",
      "One-Minute Live Snapshot",
      "Contract Goals And Subgoals"
    ]);
  });
});
