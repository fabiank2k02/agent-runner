import { area as d3Area, curveCatmullRom, line as d3Line } from "d3-shape";

export function scaledPoints(values = [], { width = 120, height = 44, paddingX = 0, paddingY = 7 } = {}) {
  const numbers = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (!numbers.length) return [];
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const range = max - min || 1;
  const usableWidth = Math.max(1, width - paddingX * 2);
  const usableHeight = Math.max(1, height - paddingY * 2);
  return numbers.map((value, index) => {
    const x = paddingX + (index / Math.max(1, numbers.length - 1)) * usableWidth;
    const y = paddingY + (1 - (value - min) / range) * usableHeight;
    return [Number(x.toFixed(2)), Number(y.toFixed(2))];
  });
}

export function smoothLinePath(points = []) {
  if (!points.length) return "";
  return d3Line()
    .x((point) => point[0])
    .y((point) => point[1])
    .curve(curveCatmullRom.alpha(0.66))(points) || "";
}

export function smoothAreaPath(points = [], { height = 44, baseline = height - 3 } = {}) {
  if (!points.length) return "";
  return d3Area()
    .x((point) => point[0])
    .y0(baseline)
    .y1((point) => point[1])
    .curve(curveCatmullRom.alpha(0.66))(points) || "";
}
