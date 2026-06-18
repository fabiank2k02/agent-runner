import { describe, expect, it } from "vitest";
import { parseCodexStatusOutput } from "../src/codex-status.js";

describe("Codex account status parsing", () => {
  it("normalizes JSON status snapshots with weekly and rolling limits", () => {
    const snapshot = parseCodexStatusOutput(
      JSON.stringify({
        tierLabel: "Personal",
        weeklyRemaining: { remainingTokens: 9000, limitTokens: 10000 },
        rolling_5h_remaining: { remaining: 1200, limit: 2000 },
        tokenUsage: {
          inputTokens: 100,
          outputTokens: 40,
          reasoningOutputTokens: 10
        },
        weeklyResetAt: "2026-06-21T00:00:00Z",
        rolling5hResetAt: "2026-06-17T05:00:00Z"
      }),
      "2026-06-17T00:00:00.000Z"
    );

    expect(snapshot?.tierLabel).toBe("Personal");
    expect(snapshot?.weeklyRemaining?.percentRemaining).toBe(90);
    expect(snapshot?.rolling5hRemaining?.remainingTokens).toBe(1200);
    expect(snapshot?.tokenUsage.totalTokens).toBe(140);
    expect(snapshot?.reset.weeklyResetAt).toBe("2026-06-21T00:00:00Z");
  });

  it("extracts useful values from text status output", () => {
    const snapshot = parseCodexStatusOutput(
      [
        "Account tier: Team",
        "Weekly remaining: 8,000 / 10,000",
        "Rolling 5h remaining: 1,500 / 2,000",
        "Tokens today: 2,345",
        "Weekly reset: 2026-06-21T00:00:00Z",
        "5h reset: 2026-06-17T05:00:00Z"
      ].join("\n"),
      "2026-06-17T00:00:00.000Z"
    );

    expect(snapshot?.tierLabel).toBe("Team");
    expect(snapshot?.weeklyRemaining?.remainingTokens).toBe(8000);
    expect(snapshot?.rolling5hRemaining?.percentRemaining).toBe(75);
    expect(snapshot?.tokenUsage.tokens).toBe(2345);
    expect(snapshot?.rawStatusFormat).toBe("text");
  });

  it("returns null for unrelated output", () => {
    expect(parseCodexStatusOutput("not signed in", "2026-06-17T00:00:00.000Z")).toBeNull();
  });
});
