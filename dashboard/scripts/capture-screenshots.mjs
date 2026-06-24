import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = resolve(__dirname, "..");
const repoRoot = resolve(dashboardRoot, "..");
const reportRoot = resolve(repoRoot, "reports/dashboard-vite-react-high-fidelity-rebuild");
const localDir = resolve(reportRoot, "screenshots/local");
const port = Number(process.env.DASHBOARD_SCREENSHOT_PORT || 4179);
const baseUrl = `http://127.0.0.1:${port}`;

mkdirSync(localDir, { recursive: true });
mkdirSync(resolve(reportRoot, "comparisons"), { recursive: true });

const server = spawn(process.execPath, [
  resolve(dashboardRoot, "node_modules/vite/bin/vite.js"),
  "--host",
  "127.0.0.1",
  "--port",
  String(port)
], {
  cwd: dashboardRoot,
  stdio: ["ignore", "pipe", "pipe"]
});

let serverOutput = "";
server.stdout.on("data", (chunk) => {
  serverOutput += chunk.toString();
});
server.stderr.on("data", (chunk) => {
  serverOutput += chunk.toString();
});

try {
  await waitForServer(baseUrl);
  const browser = await chromium.launch();
  const results = {
    baseUrl,
    generatedAt: new Date().toISOString(),
    screenshots: {},
    checks: {},
    console: {},
    pageErrors: {}
  };

  const desktop = await newCheckedPage(browser, "now-design-desktop", results, { width: 1600, height: 1000 });
  await desktop.goto(`${baseUrl}/?design=1#now`, { waitUntil: "networkidle" });
  await desktop.waitForSelector("[data-testid='now-page']");
  await desktop.waitForTimeout(900);
  await desktop.screenshot({ path: resolve(localDir, "now-design-desktop.png"), fullPage: false });
  results.screenshots.nowDesignDesktop = "reports/dashboard-vite-react-high-fidelity-rebuild/screenshots/local/now-design-desktop.png";
  results.checks.nowDesignDesktopScroll = await desktop.evaluate(() => ({
    documentScrollHeight: document.documentElement.scrollHeight,
    bodyScrollHeight: document.body.scrollHeight,
    windowInnerHeight: window.innerHeight,
    fitsDocument: document.documentElement.scrollHeight <= window.innerHeight,
    fitsBody: document.body.scrollHeight <= window.innerHeight
  }));

  results.checks.carousel = await verifyCarousel(desktop);
  results.checks.navAnimation = await verifyNavAnimation(desktop);
  await desktop.close();

  const live = await newCheckedPage(browser, "now-live-desktop", results, { width: 1600, height: 1000 });
  await live.goto(`${baseUrl}/?design=0#now`, { waitUntil: "networkidle" });
  await live.waitForTimeout(900);
  await live.screenshot({ path: resolve(localDir, "now-live-desktop.png"), fullPage: false });
  results.screenshots.nowLiveDesktop = "reports/dashboard-vite-react-high-fidelity-rebuild/screenshots/local/now-live-desktop.png";
  await live.close();

  const placeholder = await newCheckedPage(browser, "placeholder-desktop", results, { width: 1600, height: 1000 });
  await placeholder.goto(`${baseUrl}/?design=1#code`, { waitUntil: "networkidle" });
  await placeholder.waitForSelector(".placeholder-page");
  await placeholder.waitForTimeout(500);
  await placeholder.screenshot({ path: resolve(localDir, "placeholder-desktop.png"), fullPage: false });
  results.screenshots.placeholderDesktop = "reports/dashboard-vite-react-high-fidelity-rebuild/screenshots/local/placeholder-desktop.png";
  results.checks.placeholderText = await placeholder.locator("text=Not implemented yet").count();
  await placeholder.close();

  const narrow = await newCheckedPage(browser, "now-design-narrow", results, { width: 390, height: 900 });
  await narrow.goto(`${baseUrl}/?design=1#now`, { waitUntil: "networkidle" });
  await narrow.waitForSelector("[data-testid='now-page']");
  await narrow.waitForTimeout(900);
  await narrow.screenshot({ path: resolve(localDir, "now-design-narrow.png"), fullPage: true });
  results.screenshots.nowDesignNarrow = "reports/dashboard-vite-react-high-fidelity-rebuild/screenshots/local/now-design-narrow.png";
  results.checks.narrowHorizontalOverflow = await narrow.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  await narrow.close();

  await browser.close();
  writeFileSync(resolve(localDir, "local-playwright-results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.checks, null, 2));
} finally {
  server.kill("SIGTERM");
}

async function newCheckedPage(browser, label, results, viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  results.console[label] = [];
  results.pageErrors[label] = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      results.console[label].push({ type: message.type(), text: message.text() });
    }
  });
  page.on("pageerror", (error) => {
    results.pageErrors[label].push(error.message);
  });
  return page;
}

async function verifyCarousel(page) {
  const before = await page.locator(".hero-title-row h1").textContent();
  await page.locator(".arrow-right").click();
  await page.waitForTimeout(850);
  const after = await page.locator(".hero-title-row h1").textContent();
  const dotCount = await page.locator(".carousel-dots button").count();
  await page.locator(".carousel-dots button").nth(1).click();
  await page.waitForTimeout(260);
  return {
    before,
    after,
    changedAfterArrow: before !== after,
    dotCount,
    arrowsVisible: await page.locator(".carousel-arrow").count()
  };
}

async function verifyNavAnimation(page) {
  const before = await page.locator(".liquid-nav-wedge").boundingBox();
  await page.locator(".liquid-nav-tab", { hasText: "Jobs" }).click();
  const samples = [];
  for (let index = 0; index < 11; index += 1) {
    await page.waitForTimeout(80);
    const box = await page.locator(".liquid-nav-wedge").boundingBox();
    samples.push(box?.x ?? null);
  }
  const after = await page.locator(".liquid-nav-wedge").boundingBox();
  const intermediateObserved = before && after
    ? samples.some((x) => x !== null && Math.abs(x - before.x) > 1 && Math.abs(x - after.x) > 1)
    : false;
  return {
    beforeX: before?.x ?? null,
    samples,
    afterX: after?.x ?? null,
    moved: before && after ? Math.abs(after.x - before.x) > 80 : false,
    intermediateObserved
  };
}

async function waitForServer(url) {
  const started = Date.now();
  while (Date.now() - started < 30000) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
  }
  throw new Error(`Timed out waiting for Vite server at ${url}\n${serverOutput}`);
}
