import { describe, expect, it } from "vitest";
import { onRequestPost } from "../dashboard/functions/api/admin/test-cleanup.js";

describe("dashboard live-test cleanup API", () => {
  it("requires a live-test prefix and deletes matching D1/R2 artifacts", async () => {
    const bad = await onRequestPost({
      request: request({ prefix: "prod" }),
      env: { DB: new FakeCleanupD1(), AGENT_RUNNER_DASHBOARD_TOKEN: "dev-token" }
    });
    expect(bad.status).toBe(400);

    const db = new FakeCleanupD1({
      jobs: 1,
      telemetry_chunks: 2,
      telemetry_streams: 1,
      telemetry_sources: 1,
      processed_streams: 1,
      processing_runs: 1
    });
    const r2 = new FakeR2(["raw/v1/runner-job/live-test-20260618t010203z-a1b2/task/00000001-a.json.gz"]);
    const ok = await onRequestPost({
      request: request({ prefix: "live-test-20260618t010203z-a1b2" }),
      env: {
        DB: db,
        RAW_TELEMETRY: r2,
        AGENT_RUNNER_DASHBOARD_TOKEN: "dev-token"
      }
    });
    const body = await ok.json();

    expect(ok.status).toBe(200);
    expect(body.deleted.jobs).toBe(1);
    expect(body.deleted.telemetry_chunks).toBe(2);
    expect(body.r2ObjectsDeleted).toBe(1);
    expect(Object.values(body.remaining).every((count) => count === 0)).toBe(true);
    expect(r2.deleted).toEqual(["raw/v1/runner-job/live-test-20260618t010203z-a1b2/task/00000001-a.json.gz"]);
  });
});

function request(payload: unknown) {
  return new Request("https://dashboard.example.com/api/admin/test-cleanup", {
    method: "POST",
    headers: {
      authorization: "Bearer dev-token",
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}

class FakeCleanupD1 {
  counts: Record<string, number>;

  constructor(counts: Record<string, number> = {}) {
    this.counts = counts;
  }

  prepare(sql: string) {
    return {
      bind: (..._args: unknown[]) => ({
        first: async () => {
          const table = tableName(sql);
          return { count: this.counts[table] || 0 };
        },
        all: async () => ({ results: [] }),
        run: async () => {
          const table = tableName(sql);
          const changes = this.counts[table] || 0;
          this.counts[table] = 0;
          return { meta: { changes } };
        }
      })
    };
  }
}

class FakeR2 {
  deleted: string[] = [];

  constructor(private readonly keys: string[]) {}

  async list(options: { prefix?: string } = {}) {
    return {
      objects: this.keys.filter((key) => !options.prefix || key.startsWith(options.prefix)).map((key) => ({ key })),
      truncated: false
    };
  }

  async delete(keys: string | string[]) {
    this.deleted.push(...(Array.isArray(keys) ? keys : [keys]));
  }
}

function tableName(sql: string): string {
  const match = sql.match(/\b(?:FROM|DELETE FROM)\s+([a-z_]+)/iu);
  return match?.[1] || "unknown";
}
