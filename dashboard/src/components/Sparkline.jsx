import { useId } from "react";
import { scaledPoints, smoothAreaPath, smoothLinePath } from "./chartPaths.js";

const toneColors = {
  cyan: { start: "#44bfff", mid: "#58e7ff", end: "#8d77ff" },
  amber: { start: "#f2b333", mid: "#ffd15b", end: "#ff8d25" },
  violet: { start: "#b56dff", mid: "#8f70ff", end: "#d688ff" }
};

export function Sparkline({ values = [], tone = "violet" }) {
  const id = useId().replace(/:/g, "");
  const points = scaledPoints(values, { width: 150, height: 54, paddingX: 5, paddingY: 10 });
  const line = smoothLinePath(points);
  const area = smoothAreaPath(points, { height: 54, baseline: 51 });
  const colors = toneColors[tone] || toneColors.violet;
  return (
    <span className={`sparkline sparkline-${tone}`} aria-hidden="true">
      <svg viewBox="0 0 150 54" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`spark-line-${id}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={colors.start} />
            <stop offset="52%" stopColor={colors.mid} />
            <stop offset="100%" stopColor={colors.end} />
          </linearGradient>
          <linearGradient id={`spark-fill-${id}`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={colors.mid} stopOpacity="0.28" />
            <stop offset="100%" stopColor={colors.mid} stopOpacity="0" />
          </linearGradient>
          <clipPath id={`spark-clip-${id}`}>
            <rect x="1" y="1" width="148" height="52" rx="7" />
          </clipPath>
          <filter id={`spark-glow-${id}`} x="-20%" y="-80%" width="140%" height="260%">
            <feGaussianBlur stdDeviation="1.7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g clipPath={`url(#spark-clip-${id})`}>
          <path className="sparkline-track" d="M4 35 C26 28 42 34 58 27 S88 32 108 22 S133 27 146 18" />
          <path className="sparkline-area" d={area} fill={`url(#spark-fill-${id})`} />
          <path className="sparkline-line" d={line} stroke={`url(#spark-line-${id})`} filter={`url(#spark-glow-${id})`} />
        </g>
      </svg>
    </span>
  );
}
