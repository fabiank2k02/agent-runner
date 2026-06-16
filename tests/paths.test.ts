import path from "node:path";
import { describe, expect, it } from "vitest";
import { projectSlugFromPath, resolveLayout } from "../src/paths.js";
import { fakeConfig } from "./helpers.js";

describe("paths", () => {
  it("creates stable project slugs from paths", () => {
    expect(projectSlugFromPath("/tmp/My Cool Project!")).toBe("my-cool-project");
  });

  it("resolves the remote runner layout", () => {
    const config = fakeConfig(path.resolve("/tmp/project"));
    const layout = resolveLayout(config);
    expect(layout.remoteProjectDir).toBe("~/agent-runner/projects/sample");
    expect(layout.remoteProjectLogDir).toBe("~/agent-runner/logs/sample");
    expect(layout.remoteCodexAuthFile).toBe("~/agent-runner/secrets/codex/auth.json");
  });
});
