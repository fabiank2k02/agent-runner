#!/usr/bin/env node
import { buildProgram } from "./program.js";

try {
  await buildProgram().parseAsync(process.argv);
} catch (error) {
  process.exitCode = 1;
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
}
