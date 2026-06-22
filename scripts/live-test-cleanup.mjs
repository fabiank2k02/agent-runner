#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: path.resolve(process.cwd(), ".env"), quiet: true });
loadDotenv({ path: path.resolve(process.cwd(), ".env.local"), override: true, quiet: true });

const prefix = argValue("--prefix");
if (!prefix) {
  fail("Usage: node scripts/live-test-cleanup.mjs --prefix live-test-YYYYMMDDTHHMMSSZ-shortid");
}

const endpoint = process.env.AGENT_RUNNER_DASHBOARD_ENDPOINT;
if (!endpoint) {
  fail("AGENT_RUNNER_DASHBOARD_ENDPOINT is required.");
}

const url = cleanupUrl(endpoint);
const headers = {
  "content-type": "application/json"
};
if (process.env.AGENT_RUNNER_DASHBOARD_TOKEN) {
  headers.authorization = `Bearer ${process.env.AGENT_RUNNER_DASHBOARD_TOKEN}`;
}
const accessId =
  process.env.AGENT_RUNNER_CF_ACCESS_CLIENT_ID ||
  process.env.CF_ACCESS_CLIENT_ID ||
  process.env.CLOUDFLARE_ACCESS_CLIENT_ID;
const accessSecret =
  process.env.AGENT_RUNNER_CF_ACCESS_CLIENT_SECRET ||
  process.env.CF_ACCESS_CLIENT_SECRET ||
  process.env.CLOUDFLARE_ACCESS_CLIENT_SECRET;
if (accessId && accessSecret) {
  headers["CF-Access-Client-Id"] = accessId;
  headers["CF-Access-Client-Secret"] = accessSecret;
}

const response = await fetch(url, {
  method: "POST",
  headers,
  body: JSON.stringify({ prefix })
});
const contentType = response.headers.get("content-type") || "";
const text = await response.text();
if (!contentType.includes("application/json")) {
  fail(`cleanup returned non-JSON ${response.status} ${contentType}: ${summarize(text)}`);
}
const body = JSON.parse(text || "{}");
console.log(JSON.stringify(body, null, 2));
const remainingTotal =
  typeof body.remainingTotal === "number"
    ? body.remainingTotal
    : Object.values(body.remaining || {}).reduce((sum, value) => sum + Number(value || 0), 0);
if (!response.ok || body.ok !== true || remainingTotal !== 0) {
  process.exitCode = 1;
}

function cleanupUrl(endpointValue) {
  const url = new URL(endpointValue);
  url.pathname = "/api/admin/test-cleanup";
  url.search = "";
  url.hash = "";
  return url.toString();
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function summarize(value) {
  return String(value || "").replace(/\s+/gu, " ").slice(0, 220);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
