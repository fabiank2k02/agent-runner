import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { doctor } from "../src/commands/doctor.js";
import type { CommandContext } from "../src/context.js";
import { FakeExecutor, FakeRemote, fakeConfig, fakeLayout, tempDir } from "./helpers.js";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllGlobals();
});

describe("doctor", () => {
  it("accepts managed DigitalOcean config without manual VPS fields", async () => {
    delete process.env.CLOUDFLARE_TOKEN;
    delete process.env.CLOUDFLARE_API_TOKEN;
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

  it("uses CLOUDFLARE_TOKEN as the primary dashboard deploy diagnostic token", async () => {
    const projectRoot = await tempDir("doctor-cloudflare");
    await fs.promises.mkdir(path.join(projectRoot, ".devcontainer"));
    await fs.promises.writeFile(path.join(projectRoot, "auth.json"), "{}\n");
    await fs.promises.mkdir(path.join(projectRoot, "dashboard"));
    await fs.promises.writeFile(
      path.join(projectRoot, "dashboard", "wrangler.toml"),
      [
        "name = \"agent-runner-dashboard\"",
        "database_id = \"d1-test\"",
        "bucket_name = \"agent-runner-raw-telemetry\""
      ].join("\n")
    );
    process.env.CLOUDFLARE_TOKEN = "cf-token";
    delete process.env.CLOUDFLARE_API_TOKEN;
    const requested: Array<{ url: string; auth: string | null; sql?: string }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      let sql: string | undefined;
      if (init.body) {
        sql = JSON.parse(String(init.body)).sql;
      }
      requested.push({ url, auth: headers.get("authorization"), sql });
      if (url.endsWith("/accounts")) {
        return json({ success: true, result: [{ id: "account-test" }] });
      }
      return json({ success: true, result: [] });
    });

    const config = fakeConfig(projectRoot);
    config.digitalOcean.token = undefined;
    const context: CommandContext = {
      config,
      layout: fakeLayout(await tempDir("doctor-cloudflare-state")),
      executor: new FakeExecutor(),
      remote: new FakeRemote(),
      dryRun: false
    };

    const result = await doctor(context);

    expect(result.ok).toBe(true);
    expect(result.checks.find((check) => check.name === "Cloudflare token")?.detail).toContain("CLOUDFLARE_TOKEN");
    expect(requested.every((request) => request.auth === "Bearer cf-token")).toBe(true);
    expect(requested.some((request) => request.sql?.startsWith("INSERT OR REPLACE INTO processing_leases"))).toBe(true);
    expect(requested.some((request) => request.sql === "DELETE FROM processing_leases WHERE id = ?")).toBe(true);
  });
});

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
