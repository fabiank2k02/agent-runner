import { describe, expect, it } from "vitest";
import { buildProgram } from "../src/program.js";

describe("program", () => {
  it("includes the primary commands in help output", () => {
    const help = buildProgram().helpInformation();
    expect(help).toContain("init");
    expect(help).toContain("push");
    expect(help).toContain("run");
    expect(help).toContain("pull");
  });
});
