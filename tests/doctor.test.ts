import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { doctor } from "../src/commands/doctor.js";
import type { CommandContext } from "../src/context.js";
import { FakeExecutor, FakeRemote, fakeConfig, fakeLayout, tempDir } from "./helpers.js";

describe("doctor", () => {
  it("accepts managed DigitalOcean config without manual VPS fields", async () => {
    const projectRoot = await tempDir("doctor-managed");
    await fs.promises.mkdir(path.join(projectRoot, ".devcontainer"));
    await fs.promises.writeFile(path.join(projectRoot, "auth.json"), "{}\n");
    const config = fakeConfig(projectRoot);
    config.projectSlug = `doctor-managed-${Date.now()}`;
    config.remote.host = undefined;
    config.remote.user = undefined;
    config.remote.password = undefined;
    config.remote.sshKey = undefined;
    config.digitalOcean.token = "do-token";

    const context: CommandContext = {
      config,
      layout: fakeLayout(await tempDir("doctor-state")),
      executor: new FakeExecutor(),
      remote: new FakeRemote(),
      dryRun: false
    };

    const result = await doctor(context);

    expect(result.ok).toBe(true);
    expect(result.checks.find((check) => check.name === "remote host")?.detail).toBe(
      "managed DigitalOcean droplet will be created"
    );
    expect(result.checks.find((check) => check.name === "remote password")?.detail).toBe(
      "managed DigitalOcean SSH key will be generated"
    );
  });
});
