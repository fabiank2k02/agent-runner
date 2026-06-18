import { describe, expect, it } from "vitest";
import { onRequestGet as processedStreamsGet } from "../dashboard/functions/api/processed-streams.js";
import { onRequestGet as memoryGet } from "../dashboard/functions/api/memory.js";

class FakeD1 {
  constructor(private readonly results: unknown[]) {}

  prepare(sql: string) {
    return {
      bind: (...args: unknown[]) => ({
        all: async () => ({ results: this.results }),
        first: async () => this.results[0] || null,
        run: async () => ({ sql, args })
      })
    };
  }
}

describe("processed dashboard APIs", () => {
  it("reads processed stream read models through Access-authenticated requests", async () => {
    const response = await processedStreamsGet({
      request: new Request("https://dashboard.example.com/api/processed-streams?projectSlug=sample", {
        headers: { "cf-access-authenticated-user-email": "me@example.com" }
      }),
      env: {
        DB: new FakeD1([
          {
            id: "codex-thread:sample:thread-1",
            project_slug: "sample",
            stream_kind: "codex-thread",
            stream_id: "thread-1",
            source_kind: "codex-cli-thread",
            status: "active",
            summary: "Thread active.",
            latest_activity: "Writing tests",
            next_action: "Run tests",
            blocker_json: "[]",
            files_json: "[{\"path\":\"src/a.ts\"}]",
            token_usage_json: "{\"totalTokens\":10}",
            cost_json: "{}",
            linked_streams_json: "[]",
            deterministic_version: "deterministic-test",
            model_version: null,
            prompt_hash: null,
            processed_through_sequence: 2,
            processed_at: "2026-06-17T00:00:00.000Z",
            metadata_json: "{}"
          }
        ])
      }
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.streams[0].files[0].path).toBe("src/a.ts");
    expect(body.streams[0].processedThroughSequence).toBe(2);
  });

  it("reads project memory with evidence", async () => {
    const response = await memoryGet({
      request: new Request("https://dashboard.example.com/api/memory", {
        headers: { authorization: "Bearer dev-token" }
      }),
      env: {
        AGENT_RUNNER_DASHBOARD_TOKEN: "dev-token",
        DB: new FakeD1([
          {
            id: "memory:sample:procedure:test",
            project_slug: "sample",
            memory_kind: "procedure",
            title: "Run tests",
            body: "Use npm test.",
            evidence_strength: "high",
            model_confidence: null,
            evidence_json: "[{\"chunkId\":\"chunk-1\"}]",
            created_at: "2026-06-17T00:00:00.000Z",
            updated_at: "2026-06-17T00:00:00.000Z",
            superseded_by: null,
            metadata_json: "{}"
          }
        ])
      }
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.memories[0].title).toBe("Run tests");
    expect(body.memories[0].evidence[0].chunkId).toBe("chunk-1");
  });
});
