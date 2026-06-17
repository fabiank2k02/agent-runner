import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../src/context.js";
import {
  flushLocalTelemetry,
  makeRawTelemetryEnvelope,
  redactSecrets,
  redactedSecretMarker,
  isDeniedLocalTelemetryPath,
  type TelemetrySourceAdapter
} from "../src/telemetry.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("raw/local telemetry helpers", () => {
  it("redacts common token, bearer, database, and private key patterns", () => {
    const input = [
      "OPENAI_API_KEY=sk-test_abcdefghijklmnopqrstuvwxyz",
      "Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456",
      "DATABASE_URL=postgres://user:password@example.com/db",
      "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----"
    ].join("\n");

    const redacted = redactSecrets(input);

    expect(redacted).not.toContain("sk-test");
    expect(redacted).not.toContain("password@example.com");
    expect(redacted).not.toContain("secret");
    expect(redacted.match(new RegExp(redactedSecretMarker, "g"))?.length).toBeGreaterThanOrEqual(4);
  });

  it("bounds oversized raw payloads with a truncation marker", () => {
    const envelope = makeRawTelemetryEnvelope({
      sourceKind: "codex-cli-thread",
      sourceId: "codex-cli-thread:sample:test",
      streamKind: "codex-thread",
      projectSlug: "sample",
      streamId: "thread-big",
      sequence: 1,
      generatedAt: "2026-06-17T00:00:00.000Z",
      payload: {
        thread: {
          prompt: "x".repeat(3 * 1024 * 1024)
        }
      }
    });

    expect(JSON.stringify(envelope.payload).length).toBeLessThan(2 * 1024 * 1024);
    expect(JSON.stringify(envelope.payload)).toContain("x");
  });

  it("honors built-in and project deny globs for local paths", () => {
    expect(isDeniedLocalTelemetryPath("/home/me/.codex/auth.json")).toBe(true);
    expect(isDeniedLocalTelemetryPath("logs/private-output.txt", ["logs/private-*"])).toBe(true);
    expect(isDeniedLocalTelemetryPath("src/telemetry.ts", ["logs/private-*"])).toBe(false);
  });

  it("tracks local collector cursors and skips unchanged deltas", async () => {
    const tmp = await fs.promises.mkdtemp(path.join(os.tmpdir(), "agent-runner-telemetry-"));
    const statePath = path.join(tmp, "state.json");
    const uploads: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      uploads.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const adapter: TelemetrySourceAdapter = {
      kind: "codex-cli-thread",
      async discover() {
        return [{ id: "thread-1", kind: "codex-thread", sourceKind: "codex-cli-thread", title: "Thread 1" }];
      },
      async readDelta(_stream, cursor) {
        return {
          cursor: { fileOffset: cursor?.fileOffset ?? 10 },
          metadata: { title: "Thread 1", status: "active", latestActivity: "Still working" },
          payload: {
            thread: {
              id: "thread-1",
              title: "Thread 1",
              status: "active",
              agentMessageSnippets: ["Still working"]
            }
          }
        };
      }
    };

    const context = fakeContext(tmp);
    const first = await flushLocalTelemetry(context, {
      adapters: [adapter],
      statePath,
      now: new Date("2026-06-17T00:00:00.000Z")
    });
    const second = await flushLocalTelemetry(context, {
      adapters: [adapter],
      statePath,
      now: new Date("2026-06-17T00:00:00.000Z")
    });
    const state = JSON.parse(await fs.promises.readFile(statePath, "utf8"));

    expect(first.uploaded).toBe(1);
    expect(second.uploaded).toBe(0);
    expect(second.skipped).toBe(1);
    expect(uploads).toHaveLength(1);
    expect(state.streams["codex-cli-thread:thread-1"].sequence).toBe(1);
    expect(state.streams["codex-cli-thread:thread-1"].cursor.fileOffset).toBe(10);
  });
});

function fakeContext(projectRoot: string): CommandContext {
  return {
    dryRun: false,
    config: {
      projectRoot,
      projectSlug: "sample",
      remote: { root: "~/agent-runner", port: 22 },
      codexAuthSource: path.join(projectRoot, "missing-auth.json"),
      devcontainer: { extraArgs: [] },
      codex: {
        sandbox: "workspace-write",
        approval: "never",
        reasoningEffort: "xhigh",
        yolo: true,
        extraArgs: []
      },
      rsync: { excludes: [] },
      telemetry: { denyGlobs: [] },
      digitalOcean: {
        region: "sfo3",
        size: "s-1vcpu-1gb",
        image: "ubuntu-24-04-x64",
        dropletName: "agent-runner-sample",
        tags: []
      },
      dashboard: {
        enabled: true,
        endpoint: "https://dashboard.example.com/api/ingest",
        token: "dev-token",
        tokenEnv: "AGENT_RUNNER_DASHBOARD_TOKEN",
        intervalSeconds: 300,
        reasoningEffort: "low",
        maxLogLines: 200,
        costs: {}
      },
      configPath: path.join(projectRoot, ".agent-runner.json")
    },
    layout: {
      projectSlug: "sample",
      localStateDir: path.join(projectRoot, ".state"),
      localStateFile: path.join(projectRoot, ".state", "sample.json"),
      remoteRoot: "~/agent-runner",
      remoteProjectDir: "~/agent-runner/projects/sample",
      remoteProjectParent: "~/agent-runner/projects",
      remoteProjectStateFile: "~/agent-runner/state/sample.json",
      remoteProjectLogDir: "~/agent-runner/logs/sample",
      remoteCodexAuthFile: "~/agent-runner/secrets/codex/auth.json"
    },
    executor: {
      async run(command: string, args: string[] = []) {
        return { command, args, exitCode: 0, stdout: "", stderr: "" };
      }
    },
    remote: {
      async run(command: string) {
        return { command, args: [], exitCode: 0, stdout: "", stderr: "" };
      },
      async interactive(command: string) {
        return { command, args: [], exitCode: 0, stdout: "", stderr: "" };
      },
      async writeText() {},
      async readText() {
        return "";
      }
    }
  };
}
