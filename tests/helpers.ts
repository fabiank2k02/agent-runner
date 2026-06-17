import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ResolvedConfig } from "../src/config.js";
import type { RunnerLayout } from "../src/paths.js";
import type { RemoteClient } from "../src/remote.js";
import type { CommandResult, ShellExecutor } from "../src/shell.js";

export async function tempDir(prefix: string): Promise<string> {
  return fs.promises.mkdtemp(path.join(os.tmpdir(), `agent-runner-${prefix}-`));
}

export function fakeConfig(projectRoot: string): ResolvedConfig {
  return {
    projectRoot,
    projectSlug: "sample",
    remote: {
      host: "vps.example.com",
      user: "ubuntu",
      port: 2222,
      password: "secret",
      root: "~/agent-runner"
    },
    codexAuthSource: path.join(projectRoot, "auth.json"),
    devcontainer: {
      extraArgs: []
    },
    codex: {
      sandbox: "workspace-write",
      approval: "never",
      reasoningEffort: "xhigh",
      yolo: true,
      extraArgs: []
    },
    rsync: {
      excludes: []
    },
    telemetry: {
      denyGlobs: []
    },
    digitalOcean: {
      token: "do-token",
      region: "sgp1",
      size: "s-2vcpu-4gb",
      image: "ubuntu-24-04-x64",
      dropletName: "agent-runner-sample",
      tags: [],
      hourlyPriceUsd: undefined
    },
    dashboard: {
      enabled: true,
      endpoint: "https://dashboard.example.com/api/ingest",
      token: "dashboard-secret",
      tokenEnv: "AGENT_RUNNER_DASHBOARD_TOKEN",
      intervalSeconds: 300,
      reasoningEffort: "low",
      maxLogLines: 200,
      costs: {}
    },
    configPath: path.join(projectRoot, ".agent-runner.json")
  };
}

export function fakeLayout(root: string): RunnerLayout {
  return {
    projectSlug: "sample",
    localStateDir: path.join(root, "state"),
    localStateFile: path.join(root, "state", "sample.json"),
    remoteRoot: "~/agent-runner",
    remoteProjectDir: "~/agent-runner/projects/sample",
    remoteProjectParent: "~/agent-runner/projects",
    remoteProjectStateFile: "~/agent-runner/state/sample.json",
    remoteProjectLogDir: "~/agent-runner/logs/sample",
    remoteCodexAuthFile: "~/agent-runner/secrets/codex/auth.json"
  };
}

export class FakeExecutor implements ShellExecutor {
  calls: Array<{ command: string; args: string[] }> = [];

  async run(command: string, args: string[] = []): Promise<CommandResult> {
    this.calls.push({ command, args });
    return { command, args, stdout: "ok", stderr: "", exitCode: 0 };
  }
}

export class FakeRemote implements RemoteClient {
  commands: string[] = [];
  writes = new Map<string, string>();
  reads = new Map<string, string>();

  async run(command: string): Promise<CommandResult> {
    this.commands.push(command);
    return { command: "ssh", args: [command], stdout: this.reads.get(command) ?? "ok", stderr: "", exitCode: 0 };
  }

  async writeText(remotePath: string, content: string): Promise<void> {
    this.writes.set(remotePath, content);
  }

  async readText(remotePath: string): Promise<string> {
    return this.reads.get(remotePath) ?? "";
  }

  async interactive(command: string): Promise<CommandResult> {
    this.commands.push(command);
    return { command: "ssh", args: [command], stdout: "", stderr: "", exitCode: 0 };
  }
}
