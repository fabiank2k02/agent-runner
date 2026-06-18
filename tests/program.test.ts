import { describe, expect, it } from "vitest";
import { buildProgram } from "../src/program.js";

describe("program", () => {
  it("includes the primary commands in help output", () => {
    const help = buildProgram().helpInformation();
    expect(help).toContain("init");
    expect(help).toContain("start");
    expect(help).toContain("finish");
    expect(help).toContain("push");
    expect(help).toContain("run");
    expect(help).toContain("pull");
    expect(help).toContain("droplet");
  });

  it("documents prompt-file support on prompt-taking commands", () => {
    expect(buildProgram().commands.find((command) => command.name() === "start")?.helpInformation()).toContain(
      "--prompt-file"
    );
    expect(buildProgram().commands.find((command) => command.name() === "run")?.helpInformation()).toContain(
      "--prompt-file"
    );
  });

  it("includes telemetry processor operational commands", () => {
    const telemetry = buildProgram().commands.find((command) => command.name() === "telemetry");
    const help = telemetry?.helpInformation() || "";
    const processor = telemetry?.commands.find((command) => command.name() === "processor");
    const autostart = telemetry?.commands.find((command) => command.name() === "autostart");

    expect(help).toContain("process-once");
    expect(help).toContain("processor");
    expect(help).toContain("autostart");
    expect(autostart?.helpInformation()).toContain("install");
    expect(autostart?.helpInformation()).toContain("status");
    expect(processor?.helpInformation()).toContain("rebuild");
    expect(processor?.helpInformation()).toContain("status");
  });
});
