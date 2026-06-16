import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { pullProject } from "../src/commands/sync.js";
import type { CommandContext } from "../src/context.js";
import { createProjectManifest } from "../src/manifest.js";
import { stateFromPush, writeLocalState } from "../src/state.js";
import { FakeExecutor, FakeRemote, fakeConfig, fakeLayout, tempDir } from "./helpers.js";

describe("pullProject", () => {
  it("refuses to pull when local content diverged from the last pushed manifest", async () => {
    const projectRoot = await tempDir("pull");
    await fs.promises.writeFile(path.join(projectRoot, "file.txt"), "before");
    const stateRoot = await tempDir("state");
    const layout = fakeLayout(stateRoot);
    const manifest = await createProjectManifest(projectRoot);
    await writeLocalState(layout, stateFromPush(layout, manifest));

    await fs.promises.writeFile(path.join(projectRoot, "file.txt"), "after");
    const context: CommandContext = {
      config: fakeConfig(projectRoot),
      layout,
      executor: new FakeExecutor(),
      remote: new FakeRemote(),
      dryRun: true
    };

    await expect(pullProject(context)).rejects.toThrow("Refusing to pull");
  });
});
