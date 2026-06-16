import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dropletStatus } from "../src/commands/droplet.js";
import { digitalOceanStateFile, readDigitalOceanState, stateWithActiveDroplet, writeDigitalOceanState } from "../src/infra-state.js";
import { fakeConfig, tempDir } from "./helpers.js";

describe("droplet lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears stale managed droplet state when DigitalOcean no longer has the droplet", async () => {
    const config = fakeConfig(await tempDir("droplet-stale"));
    config.projectSlug = `stale-${Date.now()}`;
    await writeDigitalOceanState(
      stateWithActiveDroplet(config.projectSlug, {
        id: 123456,
        name: "agent-runner-stale",
        ip: "203.0.113.10",
        region: "sgp1",
        size: "s-1vcpu-1gb",
        image: "ubuntu-24-04-x64",
        user: "root",
        sshKeyPath: "/tmp/stale-key",
        createdAt: "2026-06-16T00:00:00.000Z"
      })
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "The resource you were accessing could not be found." }), {
        status: 404,
        headers: { "Content-Type": "application/json" }
      })
    );

    try {
      const status = await dropletStatus(config);
      const state = await readDigitalOceanState(config.projectSlug);

      expect(status).toMatchObject({
        active: false,
        staleCleared: true,
        staleDroplet: {
          id: 123456,
          ip: "203.0.113.10"
        }
      });
      expect(state?.activeDroplet).toBeUndefined();
    } finally {
      await fs.promises.rm(digitalOceanStateFile(config.projectSlug), { force: true });
    }
  });
});
