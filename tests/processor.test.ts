import { describe, expect, it } from "vitest";
import {
  acquireProcessingLease,
  renewProcessingLease,
  runProcessor
} from "../dashboard/functions/_shared/processor.js";

describe("telemetry processor", () => {
  it("acquires, renews, and takes over expired leases", async () => {
    const db = new FakeD1();
    const now = new Date("2026-06-17T00:00:00.000Z");

    const first = await acquireProcessingLease(db, {
      leaseId: "project:sample:processor",
      ownerId: "owner-a",
      now,
      leaseSeconds: 30
    });
    const blocked = await acquireProcessingLease(db, {
      leaseId: "project:sample:processor",
      ownerId: "owner-b",
      now: new Date("2026-06-17T00:00:10.000Z"),
      leaseSeconds: 30
    });
    const renewed = await renewProcessingLease(db, {
      leaseId: "project:sample:processor",
      ownerId: "owner-a",
      now: new Date("2026-06-17T00:00:20.000Z"),
      leaseSeconds: 60
    });
    const renewedOwner = renewed?.owner_id;
    const takeover = await acquireProcessingLease(db, {
      leaseId: "project:sample:processor",
      ownerId: "owner-b",
      now: new Date("2026-06-17T00:02:00.000Z"),
      leaseSeconds: 30
    });

    expect(first.acquired).toBe(true);
    expect(blocked.acquired).toBe(false);
    expect(renewedOwner).toBe("owner-a");
    expect(takeover.acquired).toBe(true);
    expect(takeover.ownerId).toBe("owner-b");
  });

  it("derives processed stream facts and conservative memory from pending chunks", async () => {
    const db = new FakeD1();
    db.telemetryStreams.push(streamRow("codex-thread:sample:thread-1", "codex-thread", "thread-1"));
    db.telemetryChunks.push(chunkRow({
      streamId: "codex-thread:sample:thread-1",
      sequence: 1,
      payload: {
        thread: {
          status: "active",
          latestActivity: "Running tests",
          files: ["src/telemetry.ts"],
          commandEvents: [{ command: "npm test", status: "failed" }],
          tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          agentMessageSnippets: ["Investigating telemetry processor."]
        },
        projectMemory: [
          {
            memoryKind: "procedure",
            title: "Run tests with npm test",
            body: "The project test suite is run with npm test.",
            evidenceStrength: "high"
          }
        ]
      }
    }));

    const result = await runProcessor({
      env: { DB: db },
      projectSlug: "sample",
      ownerId: "test-owner",
      now: new Date("2026-06-17T00:00:00.000Z")
    });
    const processed = db.processedStreams[0];
    expect(result.ok).toBe(true);
    expect(result.chunksProcessed).toBe(1);
    expect(processed.processed_through_sequence).toBe(1);
    expect(processed.summary).toContain("raw chunks processed");
    expect(JSON.parse(processed.files_json)[0].path).toBe("src/telemetry.ts");
    expect(JSON.parse(processed.blocker_json)[0].kind).toBe("failed_command");
    expect(JSON.parse(processed.token_usage_json).totalTokens).toBe(15);
    expect(db.projectMemory[0].title).toBe("Run tests with npm test");
    expect(JSON.parse(db.projectMemory[0].evidence_json)[0].chunkId).toContain("chunk:");
  });

  it("is idempotent when no raw sequence is newer than the processed cursor", async () => {
    const db = new FakeD1();
    db.telemetryStreams.push(streamRow("codex-thread:sample:thread-1", "codex-thread", "thread-1"));
    db.telemetryChunks.push(chunkRow({
      streamId: "codex-thread:sample:thread-1",
      sequence: 1,
      payload: { thread: { files: ["src/a.ts"], tokenUsage: { totalTokens: 5 } } }
    }));

    const first = await runProcessor({ env: { DB: db }, projectSlug: "sample", ownerId: "owner" });
    const second = await runProcessor({ env: { DB: db }, projectSlug: "sample", ownerId: "owner" });

    expect(first.chunksProcessed).toBe(1);
    expect(second.chunksProcessed).toBe(0);
    expect(db.processedStreams).toHaveLength(1);
    expect(JSON.parse(db.processedStreams[0].token_usage_json).totalTokens).toBe(5);
  });

  it("does not double count stream-level token usage when raw chunks are processed", async () => {
    const db = new FakeD1();
    const stream = streamRow("codex-thread:sample:thread-token", "codex-thread", "thread-token");
    stream.token_usage_json = JSON.stringify({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    db.telemetryStreams.push(stream);
    db.telemetryChunks.push(chunkRow({
      streamId: "codex-thread:sample:thread-token",
      sequence: 1,
      payload: { thread: { tokenUsage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } } }
    }));

    await runProcessor({ env: { DB: db }, projectSlug: "sample", ownerId: "owner" });

    expect(JSON.parse(db.processedStreams[0].token_usage_json).totalTokens).toBe(15);
  });

  it("supersedes older memory when newer evidence says it replaces a title", async () => {
    const db = new FakeD1();
    db.projectMemory.push({
      id: "memory:sample:procedure:old",
      project_slug: "sample",
      memory_kind: "procedure",
      title: "Old deploy command",
      body: "Use the old command.",
      evidence_strength: "medium",
      model_confidence: null,
      evidence_json: "[]",
      created_at: "2026-06-16T00:00:00.000Z",
      updated_at: "2026-06-16T00:00:00.000Z",
      superseded_by: null,
      metadata_json: "{}"
    });
    db.telemetryStreams.push(streamRow("codex-thread:sample:thread-1", "codex-thread", "thread-1"));
    db.telemetryChunks.push(chunkRow({
      streamId: "codex-thread:sample:thread-1",
      sequence: 1,
      payload: {
        projectMemory: [
          {
            memoryKind: "procedure",
            title: "New deploy command",
            body: "Use npm run deploy.",
            evidenceStrength: "high",
            supersedesTitle: "Old deploy command"
          }
        ]
      }
    }));

    await runProcessor({ env: { DB: db }, projectSlug: "sample", ownerId: "owner" });

    const oldMemory = db.projectMemory.find((item) => item.title === "Old deploy command");
    const newMemory = db.projectMemory.find((item) => item.title === "New deploy command");
    expect(newMemory).toBeTruthy();
    expect(oldMemory?.superseded_by).toBe(newMemory?.id);
  });

  it("bounds R2 reads and still writes deterministic metadata", async () => {
    const db = new FakeD1();
    db.telemetryStreams.push(streamRow("runner-job:sample:task-1", "runner-job", "task-1"));
    db.telemetryChunks.push({
      ...chunkRow({ streamId: "runner-job:sample:task-1", sequence: 1, payload: null }),
      r2_key: "raw/v1/runner-job/sample/task-1/00000001-test.json.gz",
      byte_size: 200,
      payload_inline_json: null,
      metadata_json: JSON.stringify({ status: "running", latestActivity: "R2-only chunk" })
    });
    let r2Reads = 0;

    const result = await runProcessor({
      env: {
        DB: db,
        RAW_TELEMETRY: {
          async get() {
            r2Reads += 1;
            return null;
          }
        }
      },
      projectSlug: "sample",
      ownerId: "owner",
      limits: { maxR2Bytes: 50 }
    });

    expect(result.ok).toBe(true);
    expect(result.chunksSkippedForBudget).toBe(1);
    expect(r2Reads).toBe(0);
    expect(db.processedStreams[0].latest_activity).toBe("R2-only chunk");
  });
});

class FakeD1 {
  leases: any[] = [];
  runs: any[] = [];
  telemetryStreams: any[] = [];
  telemetryChunks: any[] = [];
  processedStreams: any[] = [];
  projectMemory: any[] = [];
  localThreads: any[] = [];
  accountUsageSnapshots: any[] = [];

  prepare(sql: string) {
    return {
      bind: (...args: unknown[]) => ({
        run: async () => this.run(sql, args),
        first: async () => this.first(sql, args),
        all: async () => ({ results: this.all(sql, args) })
      })
    };
  }

  run(sql: string, args: unknown[]) {
    if (sql.includes("INSERT OR IGNORE INTO processing_leases")) {
      if (!this.leases.some((row) => row.id === args[0])) {
        this.leases.push({
          id: args[0],
          owner_id: args[1],
          acquired_at: args[2],
          expires_at: args[3],
          heartbeat_at: args[4],
          metadata_json: args[5]
        });
      }
      return {};
    }
    if (sql.includes("UPDATE processing_leases") && sql.includes("SET owner_id = ?")) {
      const row = this.leases.find((item) => item.id === args[5]);
      if (row && (row.owner_id === args[6] || Date.parse(row.expires_at) <= Date.parse(String(args[7])))) {
        row.owner_id = args[0];
        row.acquired_at = args[1];
        row.expires_at = args[2];
        row.heartbeat_at = args[3];
        row.metadata_json = args[4];
      }
      return {};
    }
    if (sql.includes("UPDATE processing_leases")) {
      const row = this.leases.find((item) => item.id === args[3] && item.owner_id === args[4]);
      if (row) {
        row.expires_at = args[0];
        row.heartbeat_at = args[1];
        row.metadata_json = args[2];
      }
      return {};
    }
    if (sql.includes("INSERT INTO processing_runs")) {
      this.runs.push({
        id: args[0],
        project_slug: args[1],
        owner_id: args[2],
        mode: args[3],
        status: args[4],
        started_at: args[5],
        finished_at: args[6],
        chunks_seen: args[7],
        chunks_processed: args[8],
        streams_updated: args[9],
        memories_updated: args[10],
        errors_json: args[11],
        metadata_json: args[12]
      });
      return {};
    }
    if (sql.includes("UPDATE processing_runs")) {
      const row = this.runs.find((item) => item.id === args[8]);
      Object.assign(row, {
        status: args[0],
        finished_at: args[1],
        chunks_seen: args[2],
        chunks_processed: args[3],
        streams_updated: args[4],
        memories_updated: args[5],
        errors_json: args[6],
        metadata_json: args[7]
      });
      return {};
    }
    if (sql.includes("DELETE FROM processed_streams") && sql.includes("AND id = ?")) {
      this.processedStreams = this.processedStreams.filter((row) => !(row.project_slug === args[0] && row.id === args[1]));
      return {};
    }
    if (sql.includes("DELETE FROM processed_streams")) {
      this.processedStreams = this.processedStreams.filter((row) => row.project_slug !== args[0]);
      return {};
    }
    if (sql.includes("INSERT INTO processed_streams")) {
      const row = {
        id: args[0],
        project_slug: args[1],
        stream_kind: args[2],
        stream_id: args[3],
        source_kind: args[4],
        status: args[5],
        summary: args[6],
        latest_activity: args[7],
        next_action: args[8],
        blocker_json: args[9],
        files_json: args[10],
        token_usage_json: args[11],
        cost_json: args[12],
        linked_streams_json: args[13],
        deterministic_version: args[14],
        model_version: args[15],
        prompt_hash: args[16],
        processed_through_sequence: args[17],
        processed_at: args[18],
        metadata_json: args[19]
      };
      this.upsert(this.processedStreams, row);
      return {};
    }
    if (sql.includes("INSERT INTO project_memory")) {
      const row = {
        id: args[0],
        project_slug: args[1],
        memory_kind: args[2],
        title: args[3],
        body: args[4],
        evidence_strength: args[5],
        model_confidence: args[6],
        evidence_json: args[7],
        created_at: args[8],
        updated_at: args[9],
        superseded_by: args[10],
        metadata_json: args[11]
      };
      this.upsert(this.projectMemory, row);
      return {};
    }
    if (sql.includes("UPDATE project_memory") && sql.includes("lower(title)")) {
      for (const row of this.projectMemory) {
        if (row.project_slug === args[2] && row.title.toLowerCase() === String(args[3]).toLowerCase() && row.id !== args[4] && !row.superseded_by) {
          row.superseded_by = args[0];
          row.updated_at = args[1];
        }
      }
      return {};
    }
    if (sql.includes("UPDATE project_memory")) {
      for (const row of this.projectMemory) {
        if (row.project_slug === args[2] && !row.superseded_by) {
          row.superseded_by = `rebuild:${args[0]}`;
          row.updated_at = args[1];
        }
      }
    }
    return {};
  }

  first(sql: string, args: unknown[]) {
    if (sql.includes("FROM processing_leases")) {
      return this.leases.find((row) => row.id === args[0]) || null;
    }
    if (sql.includes("FROM processing_runs")) {
      return this.runs.filter((row) => row.project_slug === args[0]).at(-1) || null;
    }
    if (sql.includes("FROM project_memory WHERE id")) {
      return this.projectMemory.find((row) => row.id === args[0]) || null;
    }
    return null;
  }

  all(sql: string, args: unknown[]) {
    if (sql.includes("COALESCE(MAX(tc.sequence)")) {
      return this.telemetryStreams.filter((row) => row.project_slug === args[0]).map((row) => {
        const processed = this.processedStreams.find((item) => item.id === row.id);
        const latest = Math.max(0, ...this.telemetryChunks.filter((chunk) => chunk.stream_id === row.id).map((chunk) => Number(chunk.sequence)));
        return {
          id: row.id,
          stream_kind: row.stream_kind,
          stream_id: row.stream_id,
          updated_at: row.updated_at,
          processed_sequence: processed?.processed_through_sequence || 0,
          latest_sequence: latest,
          processed_at: processed?.processed_at || null
        };
      });
    }
    if (sql.includes("FROM telemetry_streams ts")) {
      return this.telemetryStreams.filter((row) => row.project_slug === args[0]).map((row) => {
        const processed = this.processedStreams.find((item) => item.id === row.id) || {};
        return {
          ...row,
          processed_status: processed.status,
          processed_summary: processed.summary,
          processed_latest_activity: processed.latest_activity,
          processed_next_action: processed.next_action,
          processed_blocker_json: processed.blocker_json,
          processed_files_json: processed.files_json,
          processed_token_usage_json: processed.token_usage_json,
          processed_cost_json: processed.cost_json,
          processed_linked_streams_json: processed.linked_streams_json,
          processed_through_sequence: processed.processed_through_sequence,
          processed_metadata_json: processed.metadata_json
        };
      }).slice(0, Number(args[1]));
    }
    if (sql.includes("FROM telemetry_chunks")) {
      return this.telemetryChunks
        .filter((row) => row.stream_id === args[0] && Number(row.sequence) > Number(args[1]))
        .sort((left, right) => Number(left.sequence) - Number(right.sequence))
        .slice(0, Number(args[2]));
    }
    if (sql.includes("FROM local_threads")) {
      return this.localThreads.filter((row) => row.linked_runner_job_id === args[0]);
    }
    if (sql.includes("FROM processed_streams")) {
      return this.processedStreams.filter((row) => !args[0] || row.project_slug === args[0]);
    }
    if (sql.includes("FROM account_usage_snapshots")) {
      return this.accountUsageSnapshots.filter((row) => row.project_slug === args[0]);
    }
    return [];
  }

  upsert(table: any[], row: any) {
    const index = table.findIndex((item) => item.id === row.id);
    if (index >= 0) {
      table[index] = { ...table[index], ...row };
    } else {
      table.push(row);
    }
  }
}

function streamRow(id: string, streamKind: string, streamId: string) {
  return {
    id,
    source_id: `source:${streamId}`,
    source_kind: streamKind === "runner-job" ? "runner-job" : "codex-cli-thread",
    stream_kind: streamKind,
    stream_id: streamId,
    project_slug: "sample",
    task_id: streamKind === "runner-job" ? streamId : null,
    title: streamId,
    status: "active",
    latest_activity: "Raw stream observed",
    created_at: "2026-06-17T00:00:00.000Z",
    updated_at: "2026-06-17T00:00:00.000Z",
    latest_telemetry_at: "2026-06-17T00:00:00.000Z",
    latest_raw_telemetry_at: "2026-06-17T00:00:00.000Z",
    terminal_at: null,
    token_usage_json: "{}",
    metadata_json: "{}",
    linked_job_id: null
  };
}

function chunkRow(input: { streamId: string; sequence: number; payload: Record<string, unknown> | null }) {
  const envelope = input.payload
    ? {
        version: 1,
        kind: "raw-telemetry",
        sourceKind: "codex-cli-thread",
        sourceId: "source",
        streamKind: input.streamId.split(":")[0],
        projectSlug: "sample",
        streamId: input.streamId.split(":").at(-1),
        sequence: input.sequence,
        generatedAt: "2026-06-17T00:00:00.000Z",
        cursor: {},
        metadata: { status: "active" },
        payload: input.payload
      }
    : null;
  return {
    id: `chunk:${input.streamId}:${input.sequence}`,
    source_id: "source",
    stream_id: input.streamId,
    source_kind: input.streamId.startsWith("runner-job") ? "runner-job" : "codex-cli-thread",
    stream_kind: input.streamId.split(":")[0],
    project_slug: "sample",
    task_id: input.streamId.startsWith("runner-job") ? input.streamId.split(":").at(-1) : null,
    sequence: input.sequence,
    r2_key: null,
    byte_size: envelope ? JSON.stringify(envelope).length : 0,
    uncompressed_byte_size: envelope ? JSON.stringify(envelope).length : 0,
    sha256: `sha-${input.sequence}`,
    created_at: "2026-06-17T00:00:00.000Z",
    generated_at: "2026-06-17T00:00:00.000Z",
    cursor_json: "{}",
    metadata_json: "{}",
    terminal_status: null,
    payload_inline_json: envelope ? JSON.stringify(envelope) : null
  };
}
