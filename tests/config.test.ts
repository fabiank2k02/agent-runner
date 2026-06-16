import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, afterEach } from "vitest";
import { resolveConfig } from "../src/config.js";
import { tempDir } from "./helpers.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("resolveConfig", () => {
  it("uses env defaults and allows project config to override them", async () => {
    const root = await tempDir("config");
    process.env.AGENT_RUNNER_REMOTE_HOST = "env-host";
    process.env.AGENT_RUNNER_REMOTE_USER = "env-user";
    process.env.AGENT_RUNNER_REMOTE_PORT = "2022";
    process.env.AGENT_RUNNER_REMOTE_PASSWORD = "env-password";

    await fs.promises.writeFile(
      path.join(root, ".agent-runner.json"),
      JSON.stringify({
        projectSlug: "custom",
        remote: {
          host: "file-host",
          root: "~/custom-root"
        },
        codex: {
          sandbox: "danger-full-access",
          approval: "never",
          extraArgs: ["--search"]
        }
      })
    );

    const config = resolveConfig(root);
    expect(config.projectSlug).toBe("custom");
    expect(config.remote.host).toBe("file-host");
    expect(config.remote.user).toBe("env-user");
    expect(config.remote.port).toBe(2022);
    expect(config.remote.password).toBe("env-password");
    expect(config.remote.root).toBe("~/custom-root");
    expect(config.codex.sandbox).toBe("danger-full-access");
    expect(config.codex.extraArgs).toEqual(["--search"]);
  });

  it("loads .env.local over .env", async () => {
    const root = await tempDir("env");
    await fs.promises.writeFile(path.join(root, ".env"), "AGENT_RUNNER_REMOTE_HOST=base\n");
    await fs.promises.writeFile(path.join(root, ".env.local"), "AGENT_RUNNER_REMOTE_HOST=local\n");

    const config = resolveConfig(root);
    expect(config.remote.host).toBe("local");
  });
});
