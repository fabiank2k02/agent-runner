import { describe, expect, it } from "vitest";
import { buildSshArgs, buildSshInvocation } from "../src/remote.js";
import { fakeConfig } from "./helpers.js";

describe("buildSshArgs", () => {
  it("includes password-oriented SSH options without exposing the password", () => {
    const args = buildSshArgs(fakeConfig("/tmp/project"), "echo ok");
    expect(args).toEqual([
      "-p",
      "2222",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "ConnectionAttempts=1",
      "-o",
      "PreferredAuthentications=password",
      "-o",
      "PubkeyAuthentication=no",
      "ubuntu@vps.example.com",
      "echo ok"
    ]);
  });

  it("uses sshpass with SSHPASS for password auth", () => {
    const invocation = buildSshInvocation(fakeConfig("/tmp/project"), "echo ok");
    expect(invocation.command).toBe("sshpass");
    expect(invocation.args.slice(0, 3)).toEqual(["-e", "ssh", "-p"]);
    expect(invocation.args).not.toContain("secret");
    expect(invocation.env?.SSHPASS).toBe("secret");
  });
});
