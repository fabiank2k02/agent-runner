import { describe, expect, it } from "vitest";
import { stateAfterDestroy, stateWithActiveDroplet } from "../src/infra-state.js";

describe("DigitalOcean state helpers", () => {
  it("records an active droplet and clears it after destroy", () => {
    const active = stateWithActiveDroplet("sample", {
      id: 123,
      name: "agent-runner-sample",
      ip: "203.0.113.10",
      region: "sgp1",
      size: "s-2vcpu-4gb",
      image: "ubuntu-24-04-x64",
      user: "root",
      sshKeyPath: "/tmp/key",
      sshKeyId: 456,
      createdAt: "2026-06-16T00:00:00.000Z"
    });

    const destroyed = stateAfterDestroy("sample");

    expect(active.activeDroplet?.ip).toBe("203.0.113.10");
    expect(destroyed.activeDroplet).toBeUndefined();
  });
});
