import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFinalProjectSnapshot, dropletStatus } from "../src/commands/droplet.js";
import { digitalOceanStateFile, readDigitalOceanState, stateWithActiveDroplet, writeDigitalOceanState } from "../src/infra-state.js";
import { fakeConfig, tempDir } from "./helpers.js";

describe("droplet lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("clears stale managed droplet state when DigitalOcean no longer has the droplet", async () => {
    const config = fakeConfig(await tempDir("droplet-stale"));
    config.projectSlug = `stale-${Date.now()}`;
    await writeDigitalOceanState({
      ...stateWithActiveDroplet(config.projectSlug, {
        id: 123456,
        name: "agent-runner-stale",
        ip: "203.0.113.10",
        region: "sgp1",
        size: "s-1vcpu-1gb",
        image: "ubuntu-24-04-x64",
        user: "root",
        sshKeyPath: "/tmp/stale-key",
        createdAt: "2026-06-16T00:00:00.000Z"
      }),
      projectSnapshot: {
        id: 321,
        name: `agent-runner-${config.projectSlug}-project-20260617T010000Z`,
        projectSlug: config.projectSlug,
        sourceDropletId: 123456,
        createdAt: "2026-06-17T01:00:00.000Z",
        role: "project"
      }
    });
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
      expect(state?.projectSnapshot?.id).toBe(321);
    } finally {
      await fs.promises.rm(digitalOceanStateFile(config.projectSlug), { force: true });
    }
  });

  it("rotates a final project snapshot and cleans older managed snapshots", async () => {
    const config = fakeConfig(await tempDir("droplet-snapshot"));
    config.projectSlug = `snapshot-${Date.now()}`;
    await writeDigitalOceanState({
      ...stateWithActiveDroplet(config.projectSlug, {
        id: 456789,
        name: "agent-runner-snapshot",
        ip: "203.0.113.20",
        region: "sgp1",
        size: "s-1vcpu-1gb",
        image: "ubuntu-24-04-x64",
        user: "root",
        sshKeyPath: "/tmp/snapshot-key",
        createdAt: "2026-06-16T00:00:00.000Z"
      }),
      projectSnapshot: {
        id: 111,
        name: `${config.projectSlug}-old`,
        projectSlug: config.projectSlug,
        sourceDropletId: 456789,
        createdAt: "2026-06-16T00:00:00.000Z",
        role: "project"
      }
    });

    const deletes: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const method = init?.method || "GET";
      if (method === "POST" && url.endsWith("/droplets/456789/actions")) {
        return jsonResponse({ action: { id: 9001, status: "completed", type: "snapshot" } });
      }
      if (method === "GET" && url.endsWith("/snapshots?resource_type=droplet&per_page=200")) {
        return jsonResponse({
          snapshots: [
            snapshotRow(222, `agent-runner-${config.projectSlug}-project-20260618T010000Z`, "2026-06-18T01:00:00Z"),
            snapshotRow(111, `agent-runner-${config.projectSlug}-project-20260616T010000Z`, "2026-06-16T01:00:00Z"),
            snapshotRow(99, `agent-runner-${config.projectSlug}-project-20260615T010000Z`, "2026-06-15T01:00:00Z")
          ]
        });
      }
      if (method === "DELETE" && url.endsWith("/snapshots/99")) {
        deletes.push(url);
        return new Response(null, { status: 204 });
      }
      return jsonResponse({ message: `unexpected ${method} ${url}` }, 500);
    });

    try {
      const result = await createFinalProjectSnapshot(config, {
        name: `agent-runner-${config.projectSlug}-project-20260618T010000Z`
      });
      const state = await readDigitalOceanState(config.projectSlug);

      expect(result.snapshot.id).toBe(222);
      expect(result.deletedSnapshotIds).toEqual([99]);
      expect(deletes).toHaveLength(1);
      expect(state?.projectSnapshot?.id).toBe(222);
      expect(state?.previousSnapshot?.id).toBe(111);
      expect(state?.lastFinalSnapshot?.id).toBe(222);
      expect(state?.lastCleanup?.deletedSnapshotIds).toEqual([99]);
    } finally {
      await fs.promises.rm(digitalOceanStateFile(config.projectSlug), { force: true });
    }
  });
});

function snapshotRow(id: number, name: string, createdAt: string) {
  return {
    id,
    name,
    resource_id: 456789,
    resource_type: "droplet",
    min_disk_size: 25,
    size_gigabytes: 3,
    created_at: createdAt,
    regions: ["sgp1"]
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
