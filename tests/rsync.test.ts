import { describe, expect, it } from "vitest";
import { buildRsyncArgs } from "../src/rsync.js";
import { fakeConfig } from "./helpers.js";

describe("buildRsyncArgs", () => {
  it("builds push args that include literal workspace sync defaults", () => {
    const args = buildRsyncArgs(fakeConfig("/workspace/project"), {
      direction: "push",
      localProjectRoot: "/workspace/project",
      remoteProjectDir: "~/agent-runner/projects/sample",
      dryRun: true,
      extraExcludes: ["custom-cache/"]
    });

    expect(args).toContain("--delete");
    expect(args).toContain("--delete-excluded");
    expect(args).toContain("--dry-run");
    expect(args).toContain("--exclude");
    expect(args).toContain(".agent-runner/tmp/");
    expect(args).toContain("custom-cache/");
    const sshTransport = args[args.indexOf("-e") + 1];
    expect(sshTransport).toContain("StrictHostKeyChecking=accept-new");
    expect(sshTransport).toContain("ConnectTimeout=10");
    expect(sshTransport).toContain("ConnectionAttempts=1");
    expect(sshTransport).toContain("PreferredAuthentications=password");
    expect(sshTransport).toContain("PubkeyAuthentication=no");
    expect(args).not.toContain("secret");
    expect(args.at(-2)).toBe("/workspace/project/");
    expect(args.at(-1)).toBe("ubuntu@vps.example.com:~/agent-runner/projects/sample/");
  });

  it("reverses source and destination for pull", () => {
    const args = buildRsyncArgs(fakeConfig("/workspace/project"), {
      direction: "pull",
      localProjectRoot: "/workspace/project",
      remoteProjectDir: "~/agent-runner/projects/sample"
    });

    expect(args.at(-2)).toBe("ubuntu@vps.example.com:~/agent-runner/projects/sample/");
    expect(args.at(-1)).toBe("/workspace/project/");
  });
});
