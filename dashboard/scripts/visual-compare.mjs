import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardRoot = resolve(__dirname, "..");
const repoRoot = resolve(dashboardRoot, "..");
const reportRoot = resolve(repoRoot, "reports/dashboard-vite-react-high-fidelity-rebuild");
const comparisonDir = resolve(reportRoot, "comparisons");
const localDesign = resolve(reportRoot, "screenshots/local/now-design-desktop.png");

mkdirSync(comparisonDir, { recursive: true });

const comparisons = [
  {
    name: "now-reference-vs-design",
    reference: resolve(repoRoot, "media/design-reference/now-final.png"),
    target: localDesign,
    output: resolve(comparisonDir, "now-reference-vs-design.png")
  },
  {
    name: "previous-vs-design",
    reference: resolve(repoRoot, "reports/dashboard-truthful-liquid-glass-rebuild/screenshots/deployed/deployed-now.png"),
    target: localDesign,
    output: resolve(comparisonDir, "previous-vs-design.png")
  }
];

const report = {
  generatedAt: new Date().toISOString(),
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
  PNG.sync.write(diff);
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
    diffRatio: mismatchedPixels / totalPixels
  });
}

writeFileSync(resolve(comparisonDir, "comparison-results.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

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
