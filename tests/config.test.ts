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
          yolo: false,
          reasoningEffort: "high",
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
    expect(config.codex.yolo).toBe(false);
    expect(config.codex.reasoningEffort).toBe("high");
    expect(config.codex.extraArgs).toEqual(["--search"]);
    expect(config.digitalOcean.region).toBe("sgp1");
    expect(config.digitalOcean.size).toBe("s-2vcpu-4gb");
    expect(config.digitalOcean.tags).toEqual([]);
  });

  it("defaults Codex to xhigh reasoning and yolo mode", async () => {
    const root = await tempDir("config-defaults");

    const config = resolveConfig(root);

    expect(config.codex.reasoningEffort).toBe("xhigh");
    expect(config.codex.yolo).toBe(true);
  });

  it("auto-enables dashboard reporting when endpoint and token env are present", async () => {
    const root = await tempDir("config-dashboard");
    process.env.AGENT_RUNNER_DASHBOARD_ENDPOINT = "https://agent-runner.example.com/api/ingest";
    process.env.AGENT_RUNNER_DASHBOARD_TOKEN = "dashboard-secret";
    process.env.AGENT_RUNNER_DASHBOARD_MODEL = "gpt-test-mini";
    process.env.AGENT_RUNNER_DASHBOARD_DO_HOURLY_USD = "0.03571";
    process.env.AGENT_RUNNER_CODEX_SUBSCRIPTION_USD = "200";
    process.env.AGENT_RUNNER_CODEX_SUBSCRIPTION_TOKENS = "100000000";

    const config = resolveConfig(root);

    expect(config.dashboard.enabled).toBe(true);
    expect(config.dashboard.endpoint).toBe("https://agent-runner.example.com/api/ingest");
    expect(config.dashboard.token).toBe("dashboard-secret");
    expect(config.dashboard.model).toBe("gpt-test-mini");
    expect(config.dashboard.reasoningEffort).toBe("low");
    expect(config.dashboard.costs.digitalOceanHourlyUsd).toBe(0.03571);
    expect(config.dashboard.costs.codexSubscriptionMonthlyUsd).toBe(200);
    expect(config.dashboard.costs.codexSubscriptionMonthlyTokens).toBe(100000000);
  });

  it("lets project config disable dashboard reporting even when env is present", async () => {
    const root = await tempDir("config-dashboard-disabled");
    process.env.AGENT_RUNNER_DASHBOARD_ENDPOINT = "https://agent-runner.example.com/api/ingest";
    process.env.AGENT_RUNNER_DASHBOARD_TOKEN = "dashboard-secret";
    await fs.promises.writeFile(
      path.join(root, ".agent-runner.json"),
      JSON.stringify({
        dashboard: {
          enabled: false
        }
      })
    );

    const config = resolveConfig(root);

    expect(config.dashboard.enabled).toBe(false);
  });

  it("loads .env.local over .env", async () => {
    const root = await tempDir("env");
    await fs.promises.writeFile(path.join(root, ".env"), "AGENT_RUNNER_REMOTE_HOST=base\n");
    await fs.promises.writeFile(path.join(root, ".env.local"), "AGENT_RUNNER_REMOTE_HOST=local\n");

    const config = resolveConfig(root);
    expect(config.remote.host).toBe("local");
  });
});
