import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runTask, sessionName } from "../src/commands/tasks.js";
import type { CommandContext } from "../src/context.js";
import { FakeExecutor, FakeRemote, fakeConfig, fakeLayout, tempDir } from "./helpers.js";

describe("tasks", () => {
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
    expect(state.lastTask.taskId).toBe("task-1");
    expect(state.lastTask.logFile).toBe("~/agent-runner/logs/sample/task-1.jsonl");
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
