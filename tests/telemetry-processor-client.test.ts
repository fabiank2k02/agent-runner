import { afterEach, describe, expect, it, vi } from "vitest";
import { processTelemetryOnce } from "../src/telemetry-processor.js";
import type { CommandContext } from "../src/context.js";
import { fakeConfig, fakeLayout, FakeExecutor, FakeRemote, tempDir } from "./helpers.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("telemetry processor client", () => {
  it("rejects Cloudflare Access HTML instead of coercing it to an empty object", async () => {
    const context = await fakeContext();
    vi.stubGlobal("fetch", async () =>
      new Response("<!doctype html><title>Cloudflare Access</title>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      })
    );

    await expect(processTelemetryOnce(context)).rejects.toThrow(/non-JSON response.*Cloudflare Access/iu);
  });

  it("sends Cloudflare Access service-token headers when configured", async () => {
    const context = await fakeContext();
    context.config.dashboard.token = undefined;
    context.config.dashboard.accessClientId = "client-id";
    context.config.dashboard.accessClientSecret = "client-secret";
    let headers: Headers;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      headers = new Headers(init.headers);
      return new Response(JSON.stringify({ ok: true, status: "completed" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    });

    const result = await processTelemetryOnce(context);

    expect(result.ok).toBe(true);
    expect(headers!.get("authorization")).toBeNull();
    expect(headers!.get("cf-access-client-id")).toBe("client-id");
    expect(headers!.get("cf-access-client-secret")).toBe("client-secret");
  });
});

async function fakeContext(): Promise<CommandContext> {
  const root = await tempDir("processor-client");
  return {
    config: fakeConfig(root),
    layout: fakeLayout(root),
    executor: new FakeExecutor(),
    remote: new FakeRemote(),
    dryRun: false
  };
}
