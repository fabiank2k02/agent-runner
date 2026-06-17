import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runTask, sessionName } from "../src/commands/tasks.js";
import type { CommandContext } from "../src/context.js";
import { FakeExecutor, FakeRemote, fakeConfig, fakeLayout, tempDir } from "./helpers.js";

describe("tasks", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({
        jobs: [
          { id: "sample:task-1" },
          { id: "sample:task-2" }
        ]
      })))
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts a deterministic tmux session and records local task state", async () => {
    const projectRoot = await tempDir("task-project");
    const stateRoot = await tempDir("task-state");
    const layout = fakeLayout(stateRoot);
    const remote = new FakeRemote();
    const context: CommandContext = {
      config: fakeConfig(projectRoot),
      layout,
      executor: new FakeExecutor(),
      remote,
      dryRun: false
    };

    const result = await runTask(context, "finish the feature", { taskId: "task-1" });
    const state = JSON.parse(await fs.promises.readFile(layout.localStateFile, "utf8"));

    expect(result.sessionName).toBe(sessionName("sample", "task-1"));
    expect(remote.writes.get("~/agent-runner/logs/sample/task-1.prompt.txt")).toBe("finish the feature");
    expect(remote.commands.some((command) => command.includes("tmux new-session"))).toBe(true);
    expect(remote.writes.get("~/agent-runner/logs/sample/task-1.run.sh")).toContain(
      "model_reasoning_effort=\"xhigh\""
    );
    expect(remote.writes.get("~/agent-runner/logs/sample/task-1.run.sh")).toContain(
      "--dangerously-bypass-approvals-and-sandbox"
    );
    expect(remote.writes.get("~/agent-runner/logs/sample/task-1.run.sh")).toContain("< /dev/null");
    expect(state.lastTask.taskId).toBe("task-1");
    expect(state.lastTask.logFile).toBe("~/agent-runner/logs/sample/task-1.jsonl");
  });

  it("starts an isolated dashboard observer when dashboard reporting is enabled", async () => {
    const projectRoot = await tempDir("task-project-dashboard");
    const stateRoot = await tempDir("task-state-dashboard");
    const layout = fakeLayout(stateRoot);
    const remote = new FakeRemote();
    const config = fakeConfig(projectRoot);
    config.dashboard = {
      enabled: true,
      endpoint: "https://dashboard.example.com/api/ingest",
      token: "dashboard-secret",
      tokenEnv: "AGENT_RUNNER_DASHBOARD_TOKEN",
      intervalSeconds: 15,
      model: "gpt-test-mini",
      reasoningEffort: "low",
      maxLogLines: 120,
      costs: {
        digitalOceanHourlyUsd: 0.03571,
        codexSubscriptionMonthlyUsd: 200,
        codexSubscriptionMonthlyTokens: 100000000
      }
    };
    const context: CommandContext = {
      config,
      layout,
      executor: new FakeExecutor(),
      remote,
      dryRun: false
    };

    const result = await runTask(context, "finish the feature", { taskId: "task-2" });
    const state = JSON.parse(await fs.promises.readFile(layout.localStateFile, "utf8"));

    expect(result.dashboardObserver?.enabled).toBe(true);
    expect(result.dashboardObserver?.verified).toBe(true);
    expect(result.dashboardObserver?.sessionName).toBe("agent-runner-sample-observer-task-2");
    expect(state.lastTask.dashboardObserverSessionName).toBe("agent-runner-sample-observer-task-2");
    expect(remote.commands.some((command) => command.includes("agent-runner-sample-observer-task-2"))).toBe(true);
    expect(remote.commands.some((command) => command.includes("/usr/local/bin"))).toBe(true);
    const observerScript = remote.writes.get("~/agent-runner/logs/sample/task-2.observer.mjs");
    expect(observerScript).toContain("https://dashboard.example.com/api/ingest");
    expect(observerScript).toContain("CODEX_HOME");
    expect(observerScript).toContain("gpt-test-mini");
    expect(observerScript).toContain("maxLogLines");
    expect(observerScript).toContain("digitalOceanHourlyUsd");
    expect(observerScript).toContain("kind, prompt, status, logTail, summary, durableHistory");
    expect(observerScript).toContain("extractLiveEvents(logTail");
    expect(observerScript).toContain("durableHistory");
    expect(observerScript).toContain("--skip-git-repo-check");
    expect(observerScript).toContain("function finalizeSummaryForStatus(summary, status)");
    expect(observerScript).toContain("function expandHome(value)");
    expect(observerScript).toContain('config[key] = expandHome(config[key])');
    expect(observerScript).toContain("fs.mkdirSync(path.dirname(config.summaryFile), { recursive: true })");
    expect(observerScript).toContain("source: \"prompt|agent_plan|events|summary\"");
  });

  it("rejects task ids that would alter remote paths", async () => {
    const projectRoot = await tempDir("task-project-invalid");
    const stateRoot = await tempDir("task-state-invalid");
    const context: CommandContext = {
      config: fakeConfig(projectRoot),
      layout: fakeLayout(stateRoot),
      executor: new FakeExecutor(),
      remote: new FakeRemote(),
      dryRun: false
    };

    await expect(runTask(context, "prompt", { taskId: "../nope" })).rejects.toThrow("Task id");
  });
});
