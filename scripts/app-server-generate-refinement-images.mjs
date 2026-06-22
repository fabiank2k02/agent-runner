#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { readPngDimensions } from "../dist/app-server-artifacts.js";

const promptFile = "design_explorations/now_surface_refinement_pass/image_prompts.md";
const outputDir = "design_explorations/now_surface_refinement_pass/generated_mockups";
const expectedFiles = [
  "01-now-command-center.png",
  "02-now-plus-usage-rail.png",
  "03-now-plus-agent-reader.png",
  "04-now-plus-work-queue.png",
  "05-now-with-status-truth.png",
  "06-now-with-local-thread-resume.png",
  "07-now-with-memory-context.png",
  "08-now-with-progress-eta.png",
  "09-now-inspect-hidden-debug.png",
  "10-now-mobile-product-surface.png"
];

const promptMarkdown = await fs.promises.readFile(promptFile, "utf8");
const prompts = parsePrompts(promptMarkdown);
await fs.promises.mkdir(outputDir, { recursive: true });

const results = [];
for (const fileName of expectedFiles) {
  const prompt = prompts.get(fileName);
  if (!prompt) {
    throw new Error("Missing prompt section for " + fileName);
  }
  const taskId = "now-surface-refinement-" + fileName.replace(/\.png$/u, "");
  const fullPrompt = [
    "Use Codex app-server image generation for this task.",
    "Generate exactly one real PNG image artifact. Do not create HTML, CSS, SVG, canvas, screenshots, markdown, or placeholder files.",
    "Save/export is handled by the app-server artifact pipeline; focus only on generating the image.",
    prompt
  ].join("\n\n");

  const smoke = await runSmoke(taskId, fullPrompt);
  if (!smoke.ok || !smoke.file) {
    throw new Error("Image generation failed for " + fileName + ": " + JSON.stringify(smoke));
  }

  const target = path.join(outputDir, fileName);
  await fs.promises.copyFile(smoke.file, target);
  const bytes = await fs.promises.readFile(target);
  const dimensions = readPngDimensions(bytes);
  if (!dimensions || bytes.length <= 4096) {
    throw new Error("Generated file did not verify as a non-trivial PNG: " + target);
  }
  results.push({
    file: target,
    sourceFile: smoke.file,
    manifestFile: smoke.manifestFile,
    byteLength: bytes.length,
    dimensions
  });
  console.log(JSON.stringify({ generated: target, byteLength: bytes.length, dimensions }));
}

const extraFiles = (await fs.promises.readdir(outputDir)).filter((entry) => !expectedFiles.includes(entry));
if (extraFiles.length > 0) {
  throw new Error("Unexpected extra files in " + outputDir + ": " + extraFiles.join(", "));
}

console.log(JSON.stringify({ ok: true, count: results.length, results }, null, 2));

function parsePrompts(markdown) {
  const sections = new Map();
  const lines = markdown.split(/\r?\n/u);
  let currentName = null;
  let currentLines = [];
  for (const line of lines) {
    const heading = /^##\s+(.+\.png)\s*$/u.exec(line);
    if (heading) {
      if (currentName) {
        sections.set(currentName, currentLines.join("\n").trim());
      }
      currentName = heading[1];
      currentLines = [line];
      continue;
    }
    if (currentName) {
      currentLines.push(line);
    }
  }
  if (currentName) {
    sections.set(currentName, currentLines.join("\n").trim());
  }
  return sections;
}

function runSmoke(taskId, prompt) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/app-server-image-smoke.mjs", prompt], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        AGENT_RUNNER_SMOKE_TASK_ID: taskId,
        AGENT_RUNNER_APP_SERVER_SMOKE_TIMEOUT_MS: process.env.AGENT_RUNNER_APP_SERVER_SMOKE_TIMEOUT_MS || String(20 * 60 * 1000)
      }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error("smoke exited " + code + " for " + taskId + "\n" + stdout + "\n" + stderr));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error("unable to parse smoke output for " + taskId + ": " + (error instanceof Error ? error.message : String(error)) + "\n" + stdout));
      }
    });
  });
}
