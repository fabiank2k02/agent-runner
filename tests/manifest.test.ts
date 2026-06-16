import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createProjectManifest } from "../src/manifest.js";
import { tempDir } from "./helpers.js";

describe("createProjectManifest", () => {
  it("hashes files, env files, git data, and symlinks", async () => {
    const root = await tempDir("manifest");
    await fs.promises.mkdir(path.join(root, ".git"), { recursive: true });
    await fs.promises.writeFile(path.join(root, ".env"), "SECRET=value\n");
    await fs.promises.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    await fs.promises.writeFile(path.join(root, "file.txt"), "hello\n");
    await fs.promises.symlink("file.txt", path.join(root, "link.txt"));

    const first = await createProjectManifest(root);
    await fs.promises.writeFile(path.join(root, "file.txt"), "hello again\n");
    const second = await createProjectManifest(root);

    expect(first.entries.map((entry) => entry.path)).toContain(".env");
    expect(first.entries.map((entry) => entry.path)).toContain(".git/HEAD");
    expect(first.entries.find((entry) => entry.path === "link.txt")?.type).toBe("symlink");
    expect(second.digest).not.toBe(first.digest);
  });

  it("excludes runner-owned temp metadata only", async () => {
    const root = await tempDir("manifest-exclude");
    await fs.promises.mkdir(path.join(root, ".agent-runner", "tmp"), { recursive: true });
    await fs.promises.writeFile(path.join(root, ".agent-runner", "tmp", "x"), "ignored");
    await fs.promises.writeFile(path.join(root, ".agent-runner.json"), "{}");

    const manifest = await createProjectManifest(root);
    expect(manifest.entries.map((entry) => entry.path)).toContain(".agent-runner.json");
    expect(manifest.entries.map((entry) => entry.path)).not.toContain(".agent-runner/tmp/x");
  });
});
