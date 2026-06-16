import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pullProject } from "../src/commands/sync.js";
import type { CommandContext } from "../src/context.js";
import { createProjectManifest } from "../src/manifest.js";
import { stateFromPush, writeLocalState } from "../src/state.js";
import { FakeExecutor, FakeRemote, fakeConfig, fakeLayout, tempDir } from "./helpers.js";

describe("pullProject", () => {
  it("stashes local git changes before pulling when local content diverged from the last pushed manifest", async () => {
    const projectRoot = await tempDir("pull");
    await fs.promises.writeFile(path.join(projectRoot, "file.txt"), "before");
    const stateRoot = await tempDir("state");
    const layout = fakeLayout(stateRoot);
    const manifest = await createProjectManifest(projectRoot);
    await writeLocalState(layout, stateFromPush(layout, manifest));

    await fs.promises.writeFile(path.join(projectRoot, "file.txt"), "after");
    const executor = new PullFakeExecutor({ gitStatus: " M file.txt" });
    const context: CommandContext = {
      config: fakeConfig(projectRoot),
      layout,
      executor,
      remote: new FakeRemote(),
      dryRun: false
    };

    await expect(pullProject(context)).resolves.toEqual(expect.any(String));
    expect(executor.calls.map((call) => [call.command, ...call.args])).toContainEqual([
      "git",
      "stash",
      "push",
      "--include-untracked",
      "-m",
      expect.stringMatching(/^agent-runner pre-pull /u)
    ]);
    expect(executor.calls.some((call) => call.command === "git" && call.args[0] === "bundle")).toBe(true);
    expect(executor.calls.some((call) => call.command === "git" && call.args[0] === "fetch")).toBe(true);
    expect(executor.calls.some((call) => call.command === "git" && call.args[0] === "stash" && call.args[1] === "store")).toBe(
      true
    );
    expect(executor.calls.some((call) => call.command === "sshpass")).toBe(true);
  });

  it("pulls without stashing when local content still matches the last pushed manifest", async () => {
    const projectRoot = await tempDir("pull-clean");
    await fs.promises.writeFile(path.join(projectRoot, "file.txt"), "same");
    const stateRoot = await tempDir("state-clean");
    const layout = fakeLayout(stateRoot);
    const manifest = await createProjectManifest(projectRoot);
    await writeLocalState(layout, stateFromPush(layout, manifest));

    const executor = new PullFakeExecutor({ gitStatus: " M file.txt" });
    const context: CommandContext = {
      config: fakeConfig(projectRoot),
      layout,
      executor,
      remote: new FakeRemote(),
      dryRun: true
    };

    await expect(pullProject(context)).resolves.toEqual(expect.any(String));
    expect(executor.calls.some((call) => call.command === "git")).toBe(false);
    expect(executor.calls.some((call) => call.command === "sshpass")).toBe(true);
  });

  it("does not stash local changes when the pull target is unavailable", async () => {
    const projectRoot = await tempDir("pull-missing-remote");
    await fs.promises.writeFile(path.join(projectRoot, "file.txt"), "before");
    const stateRoot = await tempDir("state-missing-remote");
    const layout = fakeLayout(stateRoot);
    const manifest = await createProjectManifest(projectRoot);
    await writeLocalState(layout, stateFromPush(layout, manifest));
    await fs.promises.writeFile(path.join(projectRoot, "file.txt"), "after");

    const executor = new PullFakeExecutor({ gitStatus: " M file.txt" });
    const context: CommandContext = {
      config: {
        ...fakeConfig(projectRoot),
        digitalOcean: {
          ...fakeConfig(projectRoot).digitalOcean,
          token: undefined
        }
      },
      layout,
      executor,
      remote: new FailingRemote(),
      dryRun: false
    };

    await expect(pullProject(context)).rejects.toThrow("remote unavailable");
    expect(executor.calls.some((call) => call.command === "git")).toBe(false);
  });
});

class PullFakeExecutor extends FakeExecutor {
  constructor(private readonly options: { gitStatus: string }) {
    super();
  }

  override async run(command: string, args: string[] = []) {
    const result = await super.run(command, args);
    if (command === "git" && args[0] === "status") {
      return { ...result, stdout: this.options.gitStatus };
    }
    return result;
  }
}

class FailingRemote extends FakeRemote {
  override async run() {
    throw new Error("remote unavailable");
  }
}
