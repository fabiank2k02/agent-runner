import { describe, expect, it } from "vitest";
import { onRequestPost } from "../dashboard/functions/api/ingest.js";

class FakeD1 {
  runs: Array<{ sql: string; args: unknown[] }> = [];

  prepare(sql: string) {
    return {
      bind: (...args: unknown[]) => ({
        run: async () => {
          this.runs.push({ sql, args });
          return {};
        }
      })
    };
  }
}

function request(payload: unknown) {
  return new Request("https://dashboard.example.com/api/ingest", {
    method: "POST",
    headers: {
      authorization: "Bearer dev-token",
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

describe("dashboard ingest API", () => {
  it("keeps old summary-only payloads compatible and durable", async () => {
    const db = new FakeD1();
    const response = await onRequestPost({
      request: request({
        projectSlug: "sample",
        taskId: "task-old",
        status: { status: "running" },
        summary: {
          currentActivity: "Running old observer",
          completed: [],
          remaining: ["wait"],
          blockers: []
        },
        logTail: "raw debug tail"
      }),
      env: { DB: db, AGENT_RUNNER_DASHBOARD_TOKEN: "dev-token" }
    });

    expect(response.status).toBe(200);
    expect(db.runs.some((run) => run.sql.includes("INSERT INTO jobs"))).toBe(true);
    expect(db.runs.some((run) => run.sql.includes("INSERT INTO summaries"))).toBe(true);
    expect(db.runs.some((run) => run.sql.includes("DELETE FROM summaries"))).toBe(false);
  });

  it("updates live telemetry without inserting history rows", async () => {
    const db = new FakeD1();
    const response = await onRequestPost({
      request: request({
        projectSlug: "sample",
        taskId: "task-live",
        status: { status: "running" },
        summary: {
          currentActivity: "Running command: npm test",
          completed: [],
          remaining: ["tests"],
          blockers: []
        },
        telemetry: {
          version: 1,
          kind: "live",
          durableHistory: false,
          events: [
            {
              id: "event-1",
              type: "command_started",
              label: "Command started",
              severity: "info",
              confidence: "high",
              command: { text: "npm test" },
              source: "json:test"
            }
          ],
          files: [],
          spend: {
            codexWeeklyBudgetUsd: 100,
            codexTaskAllocationUsd: 1,
            totalOperationalCostUsd: 1
          }
        }
      }),
      env: { DB: db, AGENT_RUNNER_DASHBOARD_TOKEN: "dev-token" }
    });

    expect(response.status).toBe(200);
    expect(db.runs.filter((run) => run.sql.includes("INSERT INTO jobs"))).toHaveLength(1);
    expect(db.runs.some((run) => run.sql.includes("INSERT INTO summaries"))).toBe(false);
    expect(db.runs.some((run) => run.sql.includes("DELETE FROM summaries"))).toBe(false);
  });

  it("stores terminal telemetry durably and bounds history only at terminal state", async () => {
    const db = new FakeD1();
    const response = await onRequestPost({
      request: request({
        projectSlug: "sample",
        taskId: "task-done",
        status: { status: "completed" },
        summary: {
          currentActivity: "Done",
          completed: ["done"],
          remaining: [],
          blockers: []
        },
        telemetry: {
          version: 1,
          kind: "live",
          durableHistory: false
        }
      }),
      env: { DB: db, AGENT_RUNNER_DASHBOARD_TOKEN: "dev-token" }
    });

    expect(response.status).toBe(200);
    expect(db.runs.some((run) => run.sql.includes("INSERT INTO summaries"))).toBe(true);
    expect(db.runs.some((run) => run.sql.includes("DELETE FROM summaries"))).toBe(true);
  });
});
