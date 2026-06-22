#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { AppServerArtifactPersistor, readPngDimensions } from "../dist/app-server-artifacts.js";

const taskId = process.env.AGENT_RUNNER_SMOKE_TASK_ID || "app-server-image-smoke";
const timeoutMs = Number(process.env.AGENT_RUNNER_APP_SERVER_SMOKE_TIMEOUT_MS || 15 * 60 * 1000);
const prompt = process.argv.slice(2).join(" ") || [
  "Generate one tiny real PNG UI mockup using the built-in image generation capability.",
  "Subject: a compact Agent Runner Now surface card with a current task, status rail, and one primary action.",
  "Do not create HTML, SVG, canvas, CSS, screenshots, markdown, or placeholder files.",
  "The required output is an actual generated PNG image artifact."
].join(" ");

const persistor = new AppServerArtifactPersistor({
  workspaceDir: process.cwd(),
  taskId,
  log: (record) => log(record)
});
const smokeDir = path.join(process.cwd(), ".agent-runner", "artifacts", taskId);
const smokeLog = path.join(smokeDir, "smoke.jsonl");

let nextId = 1;
let threadId = null;
let completed = false;
let failed = false;
let finalStatus = "unknown";
const pending = new Map();

await fs.promises.mkdir(smokeDir, { recursive: true });
await fs.promises.writeFile(smokeLog, "");

const child = spawn("codex", ["app-server", "--stdio"], {
  stdio: ["pipe", "pipe", "inherit"],
  env: {
    ...process.env,
    PATH: [(process.env.HOME || "") + "/.local/bin", process.env.PATH || ""].filter(Boolean).join(":")
  }
});

const rl = readline.createInterface({ input: child.stdout });
let artifactQueue = Promise.resolve();
const timeout = setTimeout(() => fail("smoke timed out after " + timeoutMs + "ms"), timeoutMs);

child.on("error", (error) => fail("unable to start codex app-server: " + error.message));
child.on("exit", async (code, signal) => {
  clearTimeout(timeout);
  if (!completed && !failed) {
    failed = true;
    log({ type: "error", message: "codex app-server exited before completion", exitCode: code, signal });
  }
  await finish(failed || code ? code || 1 : 0);
});

rl.on("line", (line) => {
  if (!line.trim()) {
    return;
  }
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    log({ type: "error", message: "invalid app-server JSON", detail: line });
    failed = true;
    return;
  }

  log({ type: "app_server.raw", method: message.method, hasResult: message.result !== undefined, params: summarize(message.params), result: summarize(message.result) });
  artifactQueue = artifactQueue.then(() => persistor.inspectMessage(message));

  if (message.id !== undefined && message.method) {
    handleServerRequest(message);
  } else if (message.id !== undefined) {
    handleResponse(message);
  } else if (message.method) {
    handleNotification(message);
  }
});

request("initialize", {
  clientInfo: {
    name: "agent_runner_smoke",
    title: "Agent Runner Smoke",
    version: "0.1.0"
  },
  capabilities: {
    experimentalApi: true
  }
});

function request(method, params) {
  const id = nextId++;
  pending.set(id, method);
  send({ id, method, params });
}

function send(message) {
  child.stdin.write(JSON.stringify(message) + "\n");
}

function respond(id, result) {
  send({ id, result });
}

function reject(id, message) {
  send({ id, error: { code: -32000, message } });
}

function handleResponse(message) {
  const method = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) {
    fail("app-server " + (method || "request") + " failed: " + (message.error.message || JSON.stringify(message.error)));
    return;
  }
  if (method === "initialize") {
    send({ method: "initialized", params: {} });
    request("thread/start", {
      cwd: process.cwd(),
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" }
    });
    return;
  }
  if (method === "thread/start") {
    threadId = message.result?.thread?.id || message.result?.threadId || message.result?.id || null;
    if (!threadId) {
      fail("thread/start did not return a thread id");
      return;
    }
    request("turn/start", {
      threadId,
      cwd: process.cwd(),
      effort: "low",
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
      input: [{ type: "text", text: prompt }]
    });
    return;
  }
}

function handleServerRequest(message) {
  if (message.method === "item/commandExecution/requestApproval" || message.method === "item/fileChange/requestApproval") {
    respond(message.id, { decision: "acceptForSession" });
    return;
  }
  if (message.method === "item/permissions/requestApproval") {
    respond(message.id, {
      permissions: {
        fileSystem: {
          entries: [{ access: "write", path: { type: "special", value: { kind: "root" } } }]
        },
        network: { enabled: true }
      },
      scope: "session"
    });
    return;
  }
  reject(message.id, "smoke harness cannot satisfy " + message.method);
  fail("unsupported app-server request: " + message.method);
}

function handleNotification(message) {
  if (message.method === "error") {
    failed = true;
  }
  if (message.method === "turn/completed") {
    completed = true;
    finalStatus = message.params?.turn?.status || "unknown";
    if (finalStatus !== "completed") {
      failed = true;
    }
    setTimeout(() => child.kill(), 250);
  }
}

function fail(message) {
  if (failed) {
    return;
  }
  failed = true;
  log({ type: "error", message });
  try {
    child.kill();
  } catch {}
}

async function finish(exitCode) {
  await artifactQueue.catch((error) => {
    log({ type: "artifact.error", message: error instanceof Error ? error.message : String(error) });
  });
  const manifest = await persistor.writeManifest();
  const image = manifest.images[0];
  if (!image) {
    console.error(JSON.stringify({
      ok: false,
      status: finalStatus,
      manifestFile: persistor.manifestFile,
      imageCount: manifest.images.length,
      blockers: manifest.blockers
    }, null, 2));
    process.exit(exitCode || 2);
  }

  const bytes = await fs.promises.readFile(path.join(process.cwd(), image.file));
  const dimensions = readPngDimensions(bytes);
  const ok = Boolean(dimensions && bytes.length > 4096 && dimensions.width >= 64 && dimensions.height >= 64);
  console.log(JSON.stringify({
    ok,
    status: finalStatus,
    manifestFile: persistor.manifestFile,
    file: path.join(process.cwd(), image.file),
    byteLength: bytes.length,
    dimensions
  }, null, 2));
  process.exit(ok ? exitCode : 3);
}

function summarize(value) {
  if (value === undefined || value === null) {
    return value;
  }
  const clone = JSON.parse(JSON.stringify(value, (_key, child) => {
    if (typeof child === "string" && child.length > 200) {
      return child.slice(0, 80) + "...<" + child.length + " chars>";
    }
    return child;
  }));
  return clone;
}

function log(record) {
  fs.appendFileSync(smokeLog, JSON.stringify({ timestamp: new Date().toISOString(), ...record }) + "\n");
}
