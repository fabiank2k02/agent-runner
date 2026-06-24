import { useId } from "react";
import { scaledPoints, smoothLinePath } from "./chartPaths.js";

export function PulseGraph({ values = [] }) {
  const id = useId().replace(/:/g, "");
  const points = scaledPoints(values, { width: 300, height: 44, paddingX: 8, paddingY: 8 });
  const line = smoothLinePath(points);
  return (
    <span className="pulse-graph" aria-hidden="true">
      <svg viewBox="0 0 300 44" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`pulse-line-gradient-${id}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#b968ff" />
            <stop offset="42%" stopColor="#63e8ff" />
            <stop offset="70%" stopColor="#3f8cff" />
            <stop offset="100%" stopColor="#9d70ff" />
          </linearGradient>
          <clipPath id={`pulse-clip-${id}`}>
            <rect x="1" y="1" width="298" height="42" rx="8" />
          </clipPath>
          <filter id={`pulse-glow-${id}`} x="-10%" y="-90%" width="120%" height="280%">
            <feGaussianBlur stdDeviation="2.1" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g clipPath={`url(#pulse-clip-${id})`}>
          <path className="pulse-baseline" d="M8 29H292" />
          <path className="pulse-shadow" d="M8 33 C42 26 61 31 84 26 S127 30 152 22 S190 28 218 20 S268 27 292 19" />
          <path className="pulse-path" d={line} stroke={`url(#pulse-line-gradient-${id})`} filter={`url(#pulse-glow-${id})`} />
        </g>
      </svg>
    </span>
  );
}
