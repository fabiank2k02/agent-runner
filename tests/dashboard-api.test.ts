import { describe, expect, it } from "vitest";
import { onRequestGet, onRequestPost } from "../dashboard/functions/api/ingest.js";

class FakeD1 {
  runs: Array<{ sql: string; args: unknown[] }> = [];
  firstResult: unknown = null;
  firstResults: unknown[] = [];

  prepare(sql: string) {
    return {
      bind: (...args: unknown[]) => ({
        run: async () => {
          this.runs.push({ sql, args });
          return {};
        },
        first: async () => {
          this.runs.push({ sql, args });
          return this.firstResults.length ? this.firstResults.shift() : this.firstResult;
        },
        all: async () => {
          this.runs.push({ sql, args });
          return { results: [] };
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
  it("returns JSON 401 for missing or invalid API auth", async () => {
    const response = await onRequestPost({
      request: new Request("https://dashboard.example.com/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({})
      }),
      env: { DB: new FakeD1(), AGENT_RUNNER_DASHBOARD_TOKEN: "dev-token" }
    });
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(body.error).toBe("Unauthorized");
  });

  it("accepts configured Cloudflare Access service-token headers", async () => {
    const db = new FakeD1();
    db.firstResult = {
      id: "sample:task-live",
      status: "running",
      updated_at: "2026-06-17T00:00:00.000Z"
    };

    const response = await onRequestGet({
      request: new Request("https://dashboard.example.com/api/ingest?verifyJobId=sample%3Atask-live", {
        headers: {
          "CF-Access-Client-Id": "client-id",
          "CF-Access-Client-Secret": "client-secret"
        }
      }),
      env: {
        DB: db,
        AGENT_RUNNER_CF_ACCESS_CLIENT_ID: "client-id",
        AGENT_RUNNER_CF_ACCESS_CLIENT_SECRET: "client-secret"
      }
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ exists: true });
  });

  it("verifies a job through the ingest bypass route", async () => {
    const db = new FakeD1();
    db.firstResult = {
      id: "sample:task-live",
      status: "running",
      updated_at: "2026-06-17T00:00:00.000Z"
    };

    const response = await onRequestGet({
      request: new Request("https://dashboard.example.com/api/ingest?verifyJobId=sample%3Atask-live", {
        headers: {
          authorization: "Bearer dev-token"
        }
      }),
      env: { DB: db, AGENT_RUNNER_DASHBOARD_TOKEN: "dev-token" }
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      exists: true,
      job: {
        id: "sample:task-live",
        status: "running",
        updatedAt: "2026-06-17T00:00:00.000Z"
      }
    });
    expect(db.runs[0]?.args).toEqual(["sample:task-live"]);
  });

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

  it("ingests raw runner telemetry metadata without requiring R2", async () => {
    const db = new FakeD1();
    const response = await onRequestPost({
      request: request({
        version: 1,
        kind: "raw-telemetry",
        sourceKind: "runner-job",
        sourceId: "runner-observer:sample:observer",
        streamKind: "runner-job",
        projectSlug: "sample",
        streamId: "task-raw",
        sequence: 1,
        generatedAt: "2026-06-17T00:00:00.000Z",
        cursor: { logOffset: 123 },
        metadata: { status: "running", telemetrySchemaVersion: 1 },
        payload: {
          status: { status: "running" },
          codexJsonl: {
            tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            lines: ["{}"]
          }
        }
      }),
      env: { DB: db, AGENT_RUNNER_DASHBOARD_TOKEN: "dev-token" }
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.r2Key).toBeNull();
    expect(db.runs.some((run) => run.sql.includes("INSERT INTO telemetry_sources"))).toBe(true);
    expect(db.runs.some((run) => run.sql.includes("INSERT INTO telemetry_streams"))).toBe(true);
    expect(db.runs.some((run) => run.sql.includes("INSERT INTO telemetry_chunks"))).toBe(true);
    expect(db.runs.some((run) => run.sql.includes("UPDATE jobs"))).toBe(true);
  });

  it("ingests local Codex thread telemetry into the local thread read model", async () => {
    const db = new FakeD1();
    const response = await onRequestPost({
      request: request({
        version: 1,
        kind: "raw-telemetry",
        sourceKind: "codex-cli-thread",
        sourceId: "codex-cli-thread:sample:host",
        streamKind: "codex-thread",
        projectSlug: "sample",
        streamId: "thread-1",
        sequence: 1,
        generatedAt: "2026-06-17T00:00:00.000Z",
        cursor: { fileOffset: 100 },
        metadata: { title: "Fix telemetry", status: "active", latestActivity: "Reading Codex session" },
        payload: {
          thread: {
            id: "thread-1",
            title: "Fix telemetry",
            status: "active",
            agentMessageSnippets: ["Reading Codex session"],
            tokenUsage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 }
          }
        }
      }),
      env: { DB: db, AGENT_RUNNER_DASHBOARD_TOKEN: "dev-token" }
    });

    expect(response.status).toBe(200);
    expect(db.runs.some((run) => run.sql.includes("INSERT INTO local_threads"))).toBe(true);
    expect(db.runs.some((run) => run.sql.includes("UPDATE jobs"))).toBe(false);
  });

  it("parses app-server token usage events into stream token usage", async () => {
    const db = new FakeD1();
    const response = await onRequestPost({
      request: request({
        version: 1,
        kind: "raw-telemetry",
        sourceKind: "codex-cli-thread",
        sourceId: "codex-cli-thread:sample:host",
        streamKind: "codex-thread",
        projectSlug: "sample",
        streamId: "thread-token-usage",
        sequence: 1,
        generatedAt: "2026-06-18T08:00:00.000Z",
        metadata: { title: "Token usage", status: "active" },
        payload: {
          events: [
            {
              type: "thread/tokenUsage/updated",
              usage: {
                input_tokens: 120,
                cached_input_tokens: 20,
                output_tokens: 80,
                reasoning_output_tokens: 10
              }
            }
          ]
        }
      }),
      env: { DB: db, AGENT_RUNNER_DASHBOARD_TOKEN: "dev-token" }
    });

    const streamRun = db.runs.find((run) => run.sql.includes("INSERT INTO telemetry_streams"));
    const usage = JSON.parse(String(streamRun?.args[15] || "{}"));
    expect(response.status).toBe(200);
    expect(usage.inputTokens).toBe(120);
    expect(usage.outputTokens).toBe(80);
    expect(usage.totalTokens).toBe(200);
  });

  it("parses app-server rate-limit events into account usage snapshots", async () => {
    const db = new FakeD1();
    const response = await onRequestPost({
      request: request({
        version: 1,
        kind: "raw-telemetry",
        sourceKind: "local-workspace",
        sourceId: "local-workspace:sample",
        streamKind: "workspace",
        projectSlug: "sample",
        streamId: "account-usage-sample",
        sequence: 1,
        generatedAt: "2026-06-18T08:00:00.000Z",
        payload: {
          event: {
            type: "account/rateLimits/updated",
            rateLimits: {
              primary: { durationMinutes: 300, remaining: 4100, limit: 10000, resetAt: "2026-06-18T13:00:00.000Z" },
              secondary: { durationMinutes: 10080, remaining: 72000, limit: 100000, resetAt: "2026-06-22T00:00:00.000Z" }
            },
            usage: { total_tokens: 22000 }
          }
        }
      }),
      env: { DB: db, AGENT_RUNNER_DASHBOARD_TOKEN: "dev-token" }
    });

    const usageRun = db.runs.find((run) => run.sql.includes("INSERT OR REPLACE INTO account_usage_snapshots"));
    const weekly = JSON.parse(String(usageRun?.args[4] || "{}"));
    const rolling = JSON.parse(String(usageRun?.args[5] || "{}"));
    const tokenUsage = JSON.parse(String(usageRun?.args[6] || "{}"));
    const reset = JSON.parse(String(usageRun?.args[7] || "{}"));
    expect(response.status).toBe(200);
    expect(weekly.remainingTokens).toBe(72000);
    expect(weekly.usedPercent).toBe(28);
    expect(rolling.remainingTokens).toBe(4100);
    expect(rolling.usedPercent).toBe(59);
    expect(tokenUsage.totalTokens).toBe(22000);
    expect(reset.weeklyResetAt).toBe("2026-06-22T00:00:00.000Z");
  });

  it("accepts duplicate raw chunks with the same stream sequence and hash", async () => {
    const payload = {
      version: 1,
      kind: "raw-telemetry",
      sourceKind: "runner-job",
      projectSlug: "sample",
      streamId: "task-dupe",
      sequence: 1,
      generatedAt: "2026-06-17T00:00:00.000Z",
      payload: { status: { status: "running" } }
    };
    const firstDb = new FakeD1();
    const firstResponse = await onRequestPost({
      request: request(payload),
      env: { DB: firstDb, AGENT_RUNNER_DASHBOARD_TOKEN: "dev-token" }
    });
    const firstBody = await firstResponse.json();

    const duplicateDb = new FakeD1();
    duplicateDb.firstResult = { id: "chunk:runner-job:sample:task-dupe:1", sha256: firstBody.sha256 };
    const duplicateResponse = await onRequestPost({
      request: request(payload),
      env: { DB: duplicateDb, AGENT_RUNNER_DASHBOARD_TOKEN: "dev-token" }
    });
    const duplicateBody = await duplicateResponse.json();

    expect(duplicateResponse.status).toBe(200);
    expect(duplicateBody.duplicate).toBe(true);
    expect(duplicateDb.runs.some((run) => run.sql.includes("INSERT INTO telemetry_chunks"))).toBe(false);
  });

  it("detects raw chunk sequence conflicts with a different hash", async () => {
    const db = new FakeD1();
    db.firstResults = [{ id: "chunk-existing", sha256: "different" }, { latest_sequence: 7 }];
    const response = await onRequestPost({
      request: request({
        version: 1,
        kind: "raw-telemetry",
        sourceKind: "runner-job",
        projectSlug: "sample",
        streamId: "task-conflict",
        sequence: 2,
        payload: { status: { status: "running" } }
      }),
      env: { DB: db, AGENT_RUNNER_DASHBOARD_TOKEN: "dev-token" }
    });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.conflict).toBe(true);
    expect(body.latestSequence).toBe(7);
    expect(db.runs.some((run) => run.sql.includes("INSERT OR IGNORE INTO telemetry_conflicts"))).toBe(true);
  });

  it("stores raw chunks in R2 when the binding is configured", async () => {
    const db = new FakeD1();
    const puts: Array<{ key: string; value: Uint8Array; options: unknown }> = [];
    const response = await onRequestPost({
      request: request({
        version: 1,
        kind: "raw-telemetry",
        sourceKind: "runner-job",
        projectSlug: "sample",
        streamId: "task-r2",
        sequence: 3,
        payload: { status: { status: "completed" } }
      }),
      env: {
        DB: db,
        RAW_TELEMETRY: {
          put: async (key: string, value: Uint8Array, options: unknown) => {
            puts.push({ key, value, options });
          }
        },
        AGENT_RUNNER_DASHBOARD_TOKEN: "dev-token"
      }
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(puts).toHaveLength(1);
    expect(puts[0]?.key).toMatch(/^raw\/v1\/runner-job\/sample\/task-r2\/00000003-/);
    expect(body.r2Key).toBe(puts[0]?.key);
  });
});
