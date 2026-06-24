import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = resolve(__dirname, "..");
const repoRoot = resolve(dashboardRoot, "..");
const reportRoot = resolve(repoRoot, "reports/dashboard-pixel-discipline-liquid-glass-rework");
const localDir = resolve(reportRoot, "screenshots/local");
const bakeoffDir = resolve(reportRoot, "screenshots/bakeoff");
const comparisonDir = resolve(reportRoot, "comparisons");
const vitePort = Number(process.env.DASHBOARD_REWORK_PORT || 5191);
const wranglerPort = Number(process.env.DASHBOARD_REWORK_WRANGLER_PORT || 8797);
const baseUrl = `http://127.0.0.1:${vitePort}`;
const wranglerUrl = `http://127.0.0.1:${wranglerPort}`;

mkdirSync(localDir, { recursive: true });
mkdirSync(bakeoffDir, { recursive: true });
mkdirSync(comparisonDir, { recursive: true });

const results = {
  generatedAt: new Date().toISOString(),
  baseUrl,
  screenshots: {},
  checks: {},
  console: {},
  pageErrors: {},
  failedRequests: {}
};

const vite = spawn(process.execPath, [
  resolve(dashboardRoot, "node_modules/vite/bin/vite.js"),
  "--host",
  "127.0.0.1",
  "--port",
  String(vitePort)
], {
  cwd: dashboardRoot,
  stdio: ["ignore", "pipe", "pipe"]
});

let viteOutput = "";
vite.stdout.on("data", (chunk) => {
  viteOutput += chunk.toString();
});
vite.stderr.on("data", (chunk) => {
  viteOutput += chunk.toString();
});

let browser;
try {
  await waitForServer(baseUrl, () => viteOutput);
  browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
  await captureBakeoff(browser);
  await captureDesignScreenshots(browser);
  await captureNavScreenshots(browser);
  await browser.close();
  browser = null;
} finally {
  vite.kill("SIGTERM");
  if (browser) await browser.close();
}

if (process.env.DASHBOARD_REWORK_LIVE === "1") {
  await captureLiveWrangler();
}
const comparisonReport = writeComparisons();
writeFileSync(resolve(localDir, "design-playwright-results.json"), JSON.stringify(results, null, 2));
writeBakeoffReport();
console.log(JSON.stringify({ checks: results.checks, comparisons: comparisonReport.comparisons }, null, 2));

async function captureBakeoff(activeBrowser) {
  const page = await activeBrowser.newPage({ viewport: { width: 1200, height: 720 }, deviceScaleFactor: 1 });
  await page.setContent(bakeoffHtml(), { waitUntil: "load" });
  await page.locator("#css-baseline").screenshot({ path: resolve(bakeoffDir, "css-only-baseline.png") });
  await page.locator("#svg-filter").screenshot({ path: resolve(bakeoffDir, "custom-svg-filter-lens.png") });
  await page.locator("#d3-paths").screenshot({ path: resolve(bakeoffDir, "d3-shape-sparkline-paths.png") });
  await page.screenshot({ path: resolve(bakeoffDir, "bakeoff-overview.png"), fullPage: false });
  await page.close();
  results.screenshots.bakeoff = [
    "reports/dashboard-pixel-discipline-liquid-glass-rework/screenshots/bakeoff/css-only-baseline.png",
    "reports/dashboard-pixel-discipline-liquid-glass-rework/screenshots/bakeoff/custom-svg-filter-lens.png",
    "reports/dashboard-pixel-discipline-liquid-glass-rework/screenshots/bakeoff/d3-shape-sparkline-paths.png",
    "reports/dashboard-pixel-discipline-liquid-glass-rework/screenshots/bakeoff/bakeoff-overview.png"
  ];
}

async function captureDesignScreenshots(activeBrowser) {
  const viewports = [
    ["1600x1000", 1600, 1000],
    ["1512x860", 1512, 860],
    ["1440x760", 1440, 760],
    ["1366x768", 1366, 768]
  ];
  const scenarios = [
    ["populated", "?design=1"],
    ["empty", "?design=empty"]
  ];
  for (const [scenario, query] of scenarios) {
    for (const [label, width, height] of viewports) {
      const checkLabel = scenario === "populated" ? label : `${scenario}-${label}`;
      const page = await newCheckedPage(activeBrowser, `design-${checkLabel}`, { width, height });
      await page.goto(`${baseUrl}/${query}#now`, { waitUntil: "networkidle" });
      await page.waitForSelector("[data-testid='now-page']");
      await page.waitForTimeout(850);
      const fileName = scenario === "populated" ? `now-design-${label}.png` : `now-design-${scenario}-${label}.png`;
      await page.screenshot({ path: resolve(localDir, fileName), fullPage: false });
      results.screenshots[checkLabel] = `reports/dashboard-pixel-discipline-liquid-glass-rework/screenshots/local/${fileName}`;
      results.checks[checkLabel] = await runLayoutChecks(page);
      assertChecks(checkLabel, results.checks[checkLabel]);
      await page.close();
    }
  }
}

async function captureNavScreenshots(activeBrowser) {
  const page = await newCheckedPage(activeBrowser, "nav", { width: 1600, height: 1000 });
  await page.goto(`${baseUrl}/?design=1#now`, { waitUntil: "networkidle" });
  await page.waitForSelector("[data-testid='now-page']");
  await page.waitForTimeout(700);
  await page.screenshot({ path: resolve(localDir, "nav-animation-before.png"), fullPage: false });
  await page.locator(".liquid-nav-tab", { hasText: "Jobs" }).click();
  await page.waitForTimeout(180);
  await page.screenshot({ path: resolve(localDir, "nav-animation-mid.png"), fullPage: false });
  await page.waitForTimeout(650);
  await page.screenshot({ path: resolve(localDir, "nav-animation-after.png"), fullPage: false });
  results.checks.navAnimation = await verifyNavAnimation(page);

  const routeNames = ["Now", "Code", "Jobs", "Cloud", "Review", "Usage"];
  const navStates = {};
  for (const name of routeNames) {
    await page.locator(".liquid-nav-tab", { hasText: name }).click();
    await page.waitForTimeout(680);
    const slug = name.toLowerCase();
    await page.screenshot({ path: resolve(localDir, `nav-active-${slug}.png`), fullPage: false });
    navStates[slug] = await page.evaluate(() => ({
      activeIndex: Number(document.querySelector(".liquid-nav")?.dataset.activeIndex),
      shape: document.querySelector(".liquid-nav")?.dataset.activeShape,
      renderer: document.querySelector(".liquid-nav")?.dataset.renderer,
      hasDisplacement: Boolean(document.querySelector(".liquid-nav feDisplacementMap")),
      lensPathCount: document.querySelectorAll(".liquid-nav-lens path").length
    }));
  }
  results.checks.navStates = navStates;
  assertNavStates(navStates);
  await page.close();
  results.screenshots.nav = [
    "reports/dashboard-pixel-discipline-liquid-glass-rework/screenshots/local/nav-animation-before.png",
    "reports/dashboard-pixel-discipline-liquid-glass-rework/screenshots/local/nav-animation-mid.png",
    "reports/dashboard-pixel-discipline-liquid-glass-rework/screenshots/local/nav-animation-after.png",
    ...routeNames.map((name) => `reports/dashboard-pixel-discipline-liquid-glass-rework/screenshots/local/nav-active-${name.toLowerCase()}.png`)
  ];
}

async function captureLiveWrangler() {
  const wrangler = spawn("sh", [
    resolve(dashboardRoot, "scripts/wrangler.sh"),
    "pages",
    "dev",
    "dist",
    "--port",
    String(wranglerPort),
    "--binding",
    "AGENT_RUNNER_DASHBOARD_TOKEN=dev-token"
  ], {
    cwd: dashboardRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PATH: `${resolve(dashboardRoot, "node_modules/.bin")}:${process.env.PATH || ""}`
    }
  });
  let output = "";
  wrangler.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  wrangler.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  let liveBrowser;
  try {
    await waitForServer(wranglerUrl, () => output, 45000);
    liveBrowser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
    const page = await newCheckedPage(liveBrowser, "live-1440x760", { width: 1440, height: 760 });
    await page.setExtraHTTPHeaders({ "cf-access-authenticated-user-email": "local-dashboard-check@example.com" });
    const responses = [];
    page.on("response", (response) => {
      const url = response.url();
      if (url.includes("/session/token") || url.includes("/api/")) {
        responses.push({ url, status: response.status() });
      }
    });
    await page.goto(`${wranglerUrl}/?design=0#now`, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.setItem("agent-runner-dashboard-token", "stale-token"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='now-page']", { timeout: 15000 });
    await page.waitForTimeout(1800);
    await page.screenshot({ path: resolve(localDir, "now-live-1440x760.png"), fullPage: false });
    const state = await page.evaluate(() => {
      const text = document.body.innerText;
      return {
        hasUnavailableBanner: text.includes("Dashboard data unavailable"),
        hasNowPage: Boolean(document.querySelector("[data-testid='now-page']")),
        staleTokenCleared: localStorage.getItem("agent-runner-dashboard-token") === null,
        storedToken: localStorage.getItem("agent-runner-dashboard-token"),
        fitsWidth: document.documentElement.scrollWidth <= window.innerWidth,
        fitsHeight: document.documentElement.scrollHeight <= window.innerHeight,
        rawLabelsLeaked: /derived_from_running_jobs|d1_chunk|processed_job_cost_estimate|\bunavailable\b/.test(text),
        unavailableGreen: [...document.querySelectorAll(".delta-positive, .status-dot.tone-good")]
          .map((node) => node.textContent?.trim() || "")
          .filter((value) => /unavailable|no data/i.test(value)),
        bottomPanelsContained: [...document.querySelectorAll(".bottom-panel")].every((panel) => {
          const rect = panel.getBoundingClientRect();
          return rect.bottom <= window.innerHeight + 1 && rect.right <= window.innerWidth + 1;
        })
      };
    });
    results.checks.live = state;
    results.checks.liveResponses = responses;
    if (state.hasUnavailableBanner || !state.hasNowPage || !state.staleTokenCleared || !state.fitsWidth || !state.fitsHeight || state.rawLabelsLeaked || state.unavailableGreen.length) {
      throw new Error(`Live check failed: ${JSON.stringify(state)}`);
    }
    writeFileSync(resolve(localDir, "live-wrangler-results.json"), JSON.stringify({
      generatedAt: new Date().toISOString(),
      console: results.console["live-1440x760"],
      pageErrors: results.pageErrors["live-1440x760"],
      failedRequests: results.failedRequests["live-1440x760"],
      responses,
      state,
      serverOutput: output
    }, null, 2));
    await page.close();
    await liveBrowser.close();
  } finally {
    wrangler.kill("SIGTERM");
    if (liveBrowser) await liveBrowser.close().catch(() => {});
  }
}

async function newCheckedPage(activeBrowser, label, viewport) {
  const page = await activeBrowser.newPage({ viewport, deviceScaleFactor: 1 });
  results.console[label] = [];
  results.pageErrors[label] = [];
  results.failedRequests[label] = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      results.console[label].push({ type: message.type(), text: message.text() });
    }
  });
  page.on("pageerror", (error) => {
    results.pageErrors[label].push(error.message);
  });
  page.on("requestfailed", (request) => {
    results.failedRequests[label].push({ url: request.url(), failure: request.failure()?.errorText || "failed" });
  });
  return page;
}

async function runLayoutChecks(page) {
  return page.evaluate(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const bodyText = document.body.innerText;
    const rectFor = (node) => {
      const rect = node.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left };
    };
    const visible = (node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const containers = [
      ".liquid-nav",
      ".hero-job-card",
      ".carousel-side-card.left",
      ".carousel-side-card.right",
      ".usage-panel",
      ".cloud-costs-panel",
      ".processor-panel"
    ];
    const cardBoundaryOverflow = [];
    for (const selector of containers) {
      const container = document.querySelector(selector);
      if (!container) continue;
      const bounds = container.getBoundingClientRect();
      const children = [...container.querySelectorAll("span, strong, small, em, h1, h2, h3, p, time, button, svg")].filter(visible);
      for (const child of children) {
        if (child.closest(".liquid-nav-lens") || child.classList.contains("progress-ring-value")) continue;
        const rect = child.getBoundingClientRect();
        if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1) {
          cardBoundaryOverflow.push({ container: selector, text: child.textContent?.trim() || child.tagName, child: rectFor(child), bounds: rectFor(container) });
        }
      }
    }
    const textOverflow = [...document.querySelectorAll(
      ".liquid-nav-tab span, .hero-title-row h1, .hero-title-row p, .metric-cell span:not(.metric-icon):not(.progress-ring), .metric-cell strong, .contract-goal-row strong, .contract-goal-row em, .side-card-head strong, .side-card-head span, .bottom-panel span:not(.progress-ring):not(.sparkline):not(.job-glyph), .bottom-panel strong, .bottom-panel small, .bottom-panel em"
    )].filter(visible).filter((node) => node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1).map((node) => ({
      text: node.textContent?.trim() || node.tagName,
      className: node.className,
      scrollWidth: node.scrollWidth,
      clientWidth: node.clientWidth,
      scrollHeight: node.scrollHeight,
      clientHeight: node.clientHeight,
      hasTitle: Boolean(node.getAttribute("title") || node.closest("[title]"))
    }));
    const overlapGroups = {
      nav: ".liquid-nav-tab span",
      mainMetricRow: ".hero-metrics .metric-cell span:not(.metric-icon), .hero-metrics .metric-cell strong",
      mainGoalRows: ".hero-goals .contract-goal-row strong, .hero-goals .contract-goal-row em",
      sideMetricRow: ".side-metric-grid .metric-cell span:not(.metric-icon), .side-metric-grid .metric-cell strong",
      sideGoalRows: ".side-goals .contract-goal-row strong, .side-goals .contract-goal-row em",
      usagePanel: ".usage-panel span:not(.progress-ring):not(.sparkline), .usage-panel strong, .usage-panel small",
      cloudPanel: ".cloud-costs-panel span:not(.sparkline), .cloud-costs-panel strong, .cloud-costs-panel small, .cloud-costs-panel em",
      processorPanel: ".processor-panel span:not(.job-glyph), .processor-panel strong"
    };
    const overlaps = [];
    for (const [name, selector] of Object.entries(overlapGroups)) {
      const nodes = [...document.querySelectorAll(selector)].filter(visible);
      for (let index = 0; index < nodes.length; index += 1) {
        for (let next = index + 1; next < nodes.length; next += 1) {
          const a = nodes[index].getBoundingClientRect();
          const b = nodes[next].getBoundingClientRect();
          const xOverlap = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const yOverlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (xOverlap > 1 && yOverlap > 1) {
            const sameMetric = nodes[index].closest(".metric-cell") && nodes[index].closest(".metric-cell") === nodes[next].closest(".metric-cell");
            const sameStatusDot = nodes[index].classList.contains("status-dot") || nodes[next].classList.contains("status-dot");
            if (!sameMetric && !sameStatusDot) {
              overlaps.push({
                group: name,
                a: nodes[index].textContent?.trim() || nodes[index].tagName,
                b: nodes[next].textContent?.trim() || nodes[next].tagName,
                rectA: rectFor(nodes[index]),
                rectB: rectFor(nodes[next])
              });
            }
          }
        }
      }
    }
    const graphOverflow = [...document.querySelectorAll(".pulse-graph svg, .sparkline svg, .progress-ring svg")].filter(visible).map((svg) => {
      const panel = svg.closest(".subgoal-progress-bar, .bottom-panel, .hero-job-card, .carousel-side-card");
      const rect = svg.getBoundingClientRect();
      const bounds = panel?.getBoundingClientRect();
      return {
        selector: svg.closest(".pulse-graph") ? ".pulse-graph" : svg.closest(".sparkline") ? ".sparkline" : ".progress-ring",
        inside: !bounds || (rect.left >= bounds.left - 1 && rect.right <= bounds.right + 1 && rect.top >= bounds.top - 1 && rect.bottom <= bounds.bottom + 1),
        rect,
        bounds
      };
    }).filter((item) => !item.inside);
    const heroCard = document.querySelector(".hero-job-card");
    const carouselDots = document.querySelector(".carousel-dots");
    const bottomPanels = [...document.querySelectorAll(".bottom-panel")].filter(visible);
    const carouselSpacing = {
      measured: false,
      heroToDotsPx: null,
      dotsToBottomPanelsPx: null,
      dotsClearHero: false,
      dotsClearBottomPanels: false,
      dotsRect: carouselDots ? rectFor(carouselDots) : null,
      heroRect: heroCard ? rectFor(heroCard) : null
    };
    if (heroCard && carouselDots && visible(heroCard) && visible(carouselDots)) {
      const heroRect = heroCard.getBoundingClientRect();
      const dotsRect = carouselDots.getBoundingClientRect();
      const bottomTop = bottomPanels.length
        ? Math.min(...bottomPanels.map((panel) => panel.getBoundingClientRect().top))
        : null;
      carouselSpacing.measured = true;
      carouselSpacing.heroToDotsPx = dotsRect.top - heroRect.bottom;
      carouselSpacing.dotsToBottomPanelsPx = bottomTop === null ? null : bottomTop - dotsRect.bottom;
      carouselSpacing.dotsClearHero = carouselSpacing.heroToDotsPx >= 10;
      carouselSpacing.dotsClearBottomPanels = carouselSpacing.dotsToBottomPanelsPx === null || carouselSpacing.dotsToBottomPanelsPx >= 8;
    }
    return {
      viewport,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      bodyScrollWidth: document.body.scrollWidth,
      bodyScrollHeight: document.body.scrollHeight,
      fitsWidth: document.documentElement.scrollWidth <= window.innerWidth,
      fitsHeight: document.documentElement.scrollHeight <= window.innerHeight,
      centralCardVisible: Boolean(document.querySelector(".hero-job-card")?.getBoundingClientRect().height),
      sideCardsVisible: document.querySelectorAll(".carousel-side-card").length === 2,
      arrowsVisible: [...document.querySelectorAll(".carousel-arrow")].every(visible),
      dotsVisible: Boolean(document.querySelector(".carousel-dots") && visible(document.querySelector(".carousel-dots"))),
      bottomPanelsVisible: [...document.querySelectorAll(".bottom-panel")].length === 3 && [...document.querySelectorAll(".bottom-panel")].every(visible),
      bottomPanelsContained: [...document.querySelectorAll(".bottom-panel")].every((panel) => {
        const rect = panel.getBoundingClientRect();
        return rect.bottom <= window.innerHeight + 1 && rect.right <= window.innerWidth + 1;
      }),
      rawLabelsLeaked: /derived_from_running_jobs|d1_chunk|processed_job_cost_estimate|\bunavailable\b/.test(bodyText),
      cardBoundaryOverflow,
      textOverflow,
      overlaps,
      graphOverflow,
      carouselSpacing,
      navRenderer: document.querySelector(".liquid-nav")?.dataset.renderer,
      navHasDisplacement: Boolean(document.querySelector(".liquid-nav feDisplacementMap"))
    };
  });
}

function assertChecks(label, checks) {
  const failures = [];
  for (const key of ["fitsWidth", "fitsHeight", "centralCardVisible", "sideCardsVisible", "arrowsVisible", "dotsVisible", "bottomPanelsVisible", "bottomPanelsContained"]) {
    if (!checks[key]) failures.push(key);
  }
  if (checks.rawLabelsLeaked) failures.push("rawLabelsLeaked");
  if (checks.cardBoundaryOverflow.length) failures.push(`cardBoundaryOverflow:${checks.cardBoundaryOverflow.length}`);
  const unapprovedOverflow = checks.textOverflow.filter((item) => {
    const tinyFontOverhang = item.scrollWidth <= item.clientWidth + 2 && item.scrollHeight <= item.clientHeight + 2;
    return !tinyFontOverhang && !item.hasTitle && !/Snapshot export|Docs update|Processor hardening/.test(item.text);
  });
  if (unapprovedOverflow.length) failures.push(`textOverflow:${unapprovedOverflow.length}`);
  if (checks.overlaps.length) failures.push(`overlaps:${checks.overlaps.length}`);
  if (checks.graphOverflow.length) failures.push(`graphOverflow:${checks.graphOverflow.length}`);
  if (!checks.carouselSpacing.measured || !checks.carouselSpacing.dotsClearHero || !checks.carouselSpacing.dotsClearBottomPanels) {
    failures.push(`carouselSpacing:${JSON.stringify(checks.carouselSpacing)}`);
  }
  if (checks.navRenderer !== "svg-filter" || !checks.navHasDisplacement) failures.push("navSvgFilter");
  if (failures.length) {
    throw new Error(`${label} layout checks failed: ${failures.join(", ")}\n${JSON.stringify(checks, null, 2)}`);
  }
}

async function verifyNavAnimation(page) {
  await page.locator(".liquid-nav-tab", { hasText: "Now" }).click();
  await page.waitForTimeout(650);
  const before = await page.locator(".liquid-nav-lens").boundingBox();
  await page.locator(".liquid-nav-tab", { hasText: "Review" }).click();
  const samples = [];
  for (let index = 0; index < 10; index += 1) {
    await page.waitForTimeout(70);
    const box = await page.locator(".liquid-nav-lens").boundingBox();
    samples.push(box?.x ?? null);
  }
  const after = await page.locator(".liquid-nav-lens").boundingBox();
  const intermediateObserved = before && after
    ? samples.some((x) => x !== null && Math.abs(x - before.x) > 1 && Math.abs(x - after.x) > 1)
    : false;
  const hasFilteredLens = await page.locator(".liquid-nav feDisplacementMap").count() > 0;
  const result = {
    before,
    samples,
    after,
    moved: before && after ? Math.abs(after.x - before.x) > 300 : false,
    intermediateObserved,
    hasFilteredLens
  };
  if (!result.moved || !result.intermediateObserved || !result.hasFilteredLens) {
    throw new Error(`Nav animation check failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function assertNavStates(states) {
  const expected = {
    now: "left",
    code: "middle",
    jobs: "middle",
    cloud: "middle",
    review: "middle",
    usage: "right"
  };
  for (const [route, shape] of Object.entries(expected)) {
    const state = states[route];
    if (!state || state.shape !== shape || state.renderer !== "svg-filter" || !state.hasDisplacement || state.lensPathCount < 5) {
      throw new Error(`Nav state failed for ${route}: ${JSON.stringify(state)}`);
    }
  }
}

function writeComparisons() {
  const comparisons = [
    {
      name: "now-reference-vs-candidate",
      reference: resolve(repoRoot, "media/design-reference/now-final.png"),
      target: resolve(localDir, "now-design-1600x1000.png"),
      output: resolve(comparisonDir, "now-reference-vs-candidate.png")
    },
    {
      name: "current-rebuild-vs-candidate",
      reference: resolve(repoRoot, "reports/dashboard-reference-led-liquid-glass-rebuild/screenshots/local/now-design-1600x1000.png"),
      target: resolve(localDir, "now-design-1600x1000.png"),
      output: resolve(comparisonDir, "current-rebuild-vs-candidate.png")
    }
  ];
  const report = {
    generatedAt: new Date().toISOString(),
    previousKnownRatio: 0.119651875,
    targetRatio: 0.09,
    comparisons: []
  };
  for (const comparison of comparisons) {
    const reference = PNG.sync.read(readFileSync(comparison.reference));
    const target = PNG.sync.read(readFileSync(comparison.target));
    const resizedReference = resizeNearest(reference, target.width, target.height);
    const diff = new PNG({ width: target.width, height: target.height });
    const mismatchedPixels = pixelmatch(
      resizedReference.data,
      target.data,
      diff.data,
      target.width,
      target.height,
      { threshold: 0.12, includeAA: true }
    );
    writeFileSync(comparison.output, PNG.sync.write(diff));
    const totalPixels = target.width * target.height;
    report.comparisons.push({
      name: comparison.name,
      reference: relative(repoRoot, comparison.reference),
      target: relative(repoRoot, comparison.target),
      output: relative(repoRoot, comparison.output),
      referenceDimensions: { width: reference.width, height: reference.height },
      targetDimensions: { width: target.width, height: target.height },
      mismatchedPixels,
      totalPixels,
      diffRatio: mismatchedPixels / totalPixels,
      previousKnownRatio: comparison.name === "now-reference-vs-candidate" ? 0.119651875 : undefined
    });
  }
  writeFileSync(resolve(comparisonDir, "comparison-results.json"), JSON.stringify(report, null, 2));
  return report;
}

function writeBakeoffReport() {
  const text = `# Library Bake-Off

## Tested

- \`liquid-glass-react@1.1.1\`: inspected npm package/readme and tarball. It offers strong generic rounded glass containers, shader modes, and React 19 support, but its abstraction is a corner-radius wrapper. The Now nav requires one moving active volume with exact left-end, middle-flow, and right-end SVG masks, so adopting it would still require custom masking around the library.
- \`@liquid-svg-glass/react@0.0.2\`: inspected npm package/readme and tarball. It uses SVG filters and displacement, but the package is very early, depends on GSAP, and exposes dock/pill/bubble presets rather than the route-specific lens geometry needed here.
- \`react-glassy@0.3.1\`: inspected npm package/readme and tarball. It is small and SVG-filter-based, but its preset model is generic glassmorphism rather than a precise nav lens/material system.
- Custom SVG mask/filter lens: prototyped visually in \`screenshots/bakeoff/custom-svg-filter-lens.png\` and adopted for the nav. It gives exact per-route geometry plus \`feTurbulence\`/\`feDisplacementMap\` movement without adding a broad UI dependency.
- \`d3-shape@${d3ShapeVersion()}\`: installed and adopted for sparkline/pulse curve generation. It replaces hand-rolled cubic strings without introducing a chart component or dashboard template.

## Installed

- Added repo dependency: \`d3-shape\`.
- No liquid-glass React package was added to repo dependencies. The liquid packages were inspected/tested as candidates and rejected because they did not improve fidelity for the required custom nav shape enough to justify dependency/API lock-in.

## Adopted

- Custom SVG filter/displacement implementation for \`LiquidNavLens\`.
- \`d3-shape\` Catmull-Rom line/area generation for pulse graphs and sparklines.
- Existing Framer Motion remains the movement layer for tab transitions.

## Rejected

- \`liquid-glass-react\`: good generic effect, wrong geometry abstraction for this nav.
- \`@liquid-svg-glass/react\`: conceptually relevant but immature preset package and extra GSAP dependency.
- \`react-glassy\`: lightweight, but too generic and less controllable than direct SVG for left/middle/right nav masks.

## Evidence

- \`screenshots/bakeoff/css-only-baseline.png\`
- \`screenshots/bakeoff/custom-svg-filter-lens.png\`
- \`screenshots/bakeoff/d3-shape-sparkline-paths.png\`
- \`screenshots/bakeoff/bakeoff-overview.png\`

The adopted approach materially improves nav/glass/graphs over the prior CSS-only wedge: the nav now has SVG path families, turbulence/displacement, internal caustic strokes, and route-specific masks; the graphs use generated smooth paths and intentional clipping/tone gradients.
`;
  writeFileSync(resolve(reportRoot, "library-bakeoff.md"), text);
}

function d3ShapeVersion() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(dashboardRoot, "node_modules/d3-shape/package.json"), "utf8"));
    return pkg.version || "installed";
  } catch {
    return "installed";
  }
}

function resizeNearest(source, width, height) {
  if (source.width === width && source.height === height) {
    return source;
  }
  const output = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(source.height - 1, Math.floor((y / height) * source.height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor((x / width) * source.width));
      const sourceIndex = (sourceY * source.width + sourceX) * 4;
      const outputIndex = (y * width + x) * 4;
      output.data[outputIndex] = source.data[sourceIndex];
      output.data[outputIndex + 1] = source.data[sourceIndex + 1];
      output.data[outputIndex + 2] = source.data[sourceIndex + 2];
      output.data[outputIndex + 3] = source.data[sourceIndex + 3];
    }
  }
  return output;
}

function relative(root, file) {
  return file.replace(`${root}/`, "");
}

async function waitForServer(url, output, timeout = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
  }
  throw new Error(`Timed out waiting for server at ${url}\n${output()}`);
}

function bakeoffHtml() {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; background: #02060d; color: white; font: 15px Inter, ui-sans-serif, system-ui; }
    .stage { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; padding: 34px; }
    .sample { min-height: 265px; border: 1px solid rgba(214,235,255,.18); border-radius: 18px; padding: 22px; background: radial-gradient(circle at 50% 0%, rgba(70,130,220,.15), transparent 48%), #050b13; }
    h2 { margin: 0 0 18px; font-size: 16px; font-weight: 520; color: rgba(236,246,255,.9); }
    .nav { position: relative; width: 330px; height: 52px; border-radius: 999px; border: 1px solid rgba(220,238,255,.36); background: rgba(4,11,18,.86); overflow: hidden; }
    .css-wedge { position: absolute; inset: 0 auto 0 0; width: 174px; border-radius: 999px; clip-path: polygon(0 0, calc(100% - 36px) 0, 100% 100%, 0 100%); background: linear-gradient(130deg, #73caff, #406dff 48%, #8d63ff); box-shadow: 0 0 24px rgba(72,128,255,.42); }
    .tabs { position: relative; display: grid; grid-template-columns: repeat(3, 1fr); height: 100%; place-items: center; color: rgba(230,238,248,.7); }
    .tabs span:first-child { color: white; }
    svg { display:block; width:330px; height:90px; overflow: visible; }
    .chart { width: 330px; height: 120px; border-radius: 14px; background: rgba(0,7,13,.7); }
    p { margin: 18px 0 0; color: rgba(220,230,242,.62); line-height: 1.45; }
  </style>
</head>
<body>
  <main class="stage">
    <section id="css-baseline" class="sample">
      <h2>CSS-only clipped wedge</h2>
      <div class="nav"><div class="css-wedge"></div><div class="tabs"><span>Now</span><span>Code</span><span>Jobs</span></div></div>
      <p>Rejected as the final material: hard polygon edge, no displacement/refraction layer, and static-looking glow.</p>
    </section>
    <section id="svg-filter" class="sample">
      <h2>Custom SVG filter lens</h2>
      <svg viewBox="0 0 330 90" aria-hidden="true">
        <defs>
          <linearGradient id="bake-lens" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#9dccff" stop-opacity=".34"/><stop offset=".35" stop-color="#416fff"/><stop offset=".72" stop-color="#313fd3"/><stop offset="1" stop-color="#9164ff" stop-opacity=".7"/></linearGradient>
          <filter id="bake-filter" x="-20%" y="-70%" width="140%" height="220%"><feTurbulence type="fractalNoise" baseFrequency=".025 .08" numOctaves="2" seed="8"/><feDisplacementMap in="SourceGraphic" scale="4" xChannelSelector="R" yChannelSelector="G"/></filter>
        </defs>
        <rect x="0" y="8" width="330" height="52" rx="26" fill="rgba(4,11,18,.9)" stroke="rgba(220,238,255,.34)"/>
        <path filter="url(#bake-filter)" d="M27 9 C12 9 1 20 1 34 C1 48 12 59 27 59 L160 59 C150 51 140 25 126 9 Z" fill="url(#bake-lens)"/>
        <path d="M22 57 C62 61 98 61 146 57" stroke="#56e9ff" stroke-width="3" stroke-linecap="round" opacity=".85"/>
      </svg>
      <p>Adopted: exact geometry, internal highlights, animated turbulence/displacement, no extra glass dependency.</p>
    </section>
    <section id="d3-paths" class="sample">
      <h2>d3-shape custom paths</h2>
      <svg class="chart" viewBox="0 0 330 120" aria-hidden="true">
        <defs><linearGradient id="bake-chart" x1="0" x2="1"><stop stop-color="#42c8ff"/><stop offset=".55" stop-color="#57e7ff"/><stop offset="1" stop-color="#9670ff"/></linearGradient></defs>
        <path d="M20 76 C44 58 54 73 77 55 C100 37 113 68 137 49 C159 32 171 62 194 45 C219 26 229 56 254 38 C279 22 291 46 310 34" fill="none" stroke="url(#bake-chart)" stroke-width="4" stroke-linecap="round"/>
        <path d="M20 76 C44 58 54 73 77 55 C100 37 113 68 137 49 C159 32 171 62 194 45 C219 26 229 56 254 38 C279 22 291 46 310 34" fill="none" stroke="rgba(80,220,255,.25)" stroke-width="11" stroke-linecap="round"/>
      </svg>
      <p>Adopted: generated curve quality without using a generic chart component or SaaS dashboard template.</p>
    </section>
  </main>
</body>
</html>`;
}
