import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  devcontainerTelemetryAutostartStatus,
  installDevcontainerTelemetryAutostart,
  preservedPostStartKey,
  telemetryAutostartKey,
  withTelemetryAutostart
} from "../src/devcontainer-autostart.js";
import { initProject } from "../src/commands/init.js";

describe("devcontainer telemetry autostart", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "agent-runner-autostart-"));
  });

  afterEach(async () => {
    await fs.promises.rm(root, { recursive: true, force: true });
  });

  it("installs an idempotent postStartCommand object", async () => {
    await writeDevcontainer(root, { name: "sample" });

    const result = await installDevcontainerTelemetryAutostart(root);
    const config = await readDevcontainer(root);

    expect(result.installed).toBe(true);
    expect(result.changed).toBe(true);
    expect(config.postStartCommand[telemetryAutostartKey]).toContain("telemetry start");
    expect(config.postStartCommand[telemetryAutostartKey]).toContain("|| true");

    const second = await installDevcontainerTelemetryAutostart(root);
    expect(second.changed).toBe(false);
  });

  it("preserves an existing postStartCommand", () => {
    const updated = withTelemetryAutostart({ postStartCommand: "npm run dev:prepare" });

    expect(updated.postStartCommand).toMatchObject({
      [preservedPostStartKey]: "npm run dev:prepare"
    });
    expect((updated.postStartCommand as Record<string, string>)[telemetryAutostartKey]).toContain("agent-runner");
  });

  it("reports missing devcontainers without creating one", async () => {
    const result = await devcontainerTelemetryAutostartStatus(root);

    expect(result.exists).toBe(false);
    expect(result.installed).toBe(false);
    expect(await exists(path.join(root, ".devcontainer"))).toBe(false);
  });

  it("is installed by init when a devcontainer exists", async () => {
    await writeDevcontainer(root, { name: "sample" });

    const result = await initProject(root);
    const config = await readDevcontainer(root);

    expect(result.created).toBe(true);
    expect(result.telemetryAutostart?.installed).toBe(true);
    expect(config.postStartCommand[telemetryAutostartKey]).toContain("telemetry start");
  });
});

async function writeDevcontainer(root: string, value: Record<string, unknown>): Promise<void> {
  await fs.promises.mkdir(path.join(root, ".devcontainer"), { recursive: true });
  await fs.promises.writeFile(path.join(root, ".devcontainer", "devcontainer.json"), `${JSON.stringify(value, null, 2)}\n`);
}

async function readDevcontainer(root: string): Promise<{ postStartCommand: Record<string, string> }> {
  const raw = await fs.promises.readFile(path.join(root, ".devcontainer", "devcontainer.json"), "utf8");
  return JSON.parse(raw) as { postStartCommand: Record<string, string> };
}

async function exists(target: string): Promise<boolean> {
  return fs.promises.access(target).then(() => true, () => false);
}
