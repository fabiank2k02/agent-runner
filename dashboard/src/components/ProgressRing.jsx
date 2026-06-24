import { useId } from "react";

const ringTones = {
  default: ["#5bddff", "#4b7dff", "#9a6cff"],
  usage: ["#30d88a", "#48dfff", "#347bff"],
  muted: ["#4c6d8e", "#4ba3d4", "#7d6dde"]
};

export function ProgressRing({ value, size = 152, stroke = 13, mini = false, label = null, tone = "default" }) {
  const id = useId().replace(/:/g, "");
  const numeric = typeof value === "number" ? Math.max(0, Math.min(100, value)) : 0;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const arcLength = !mini && size >= 150 ? circumference * 0.72 : circumference;
  const dash = arcLength * (numeric / 100);
  const colors = ringTones[tone] || ringTones.default;
  return (
    <span className={`progress-ring ring-${tone} ${mini ? "is-mini" : ""}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id={`ring-gradient-${id}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={colors[0]} />
            <stop offset="48%" stopColor={colors[1]} />
            <stop offset="100%" stopColor={colors[2]} />
          </linearGradient>
          <filter id={`ring-glow-${id}`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation={mini ? "1.15" : "2.4"} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle
          className="progress-ring-track"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeDasharray={`${arcLength} ${circumference - arcLength}`}
        />
        <circle
          className="progress-ring-value"
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={stroke}
          strokeDasharray={`${dash} ${circumference - dash}`}
          stroke={`url(#ring-gradient-${id})`}
          filter={`url(#ring-glow-${id})`}
        />
      </svg>
      {label ? <span className="progress-ring-label">{label}</span> : null}
    </span>
  );
}
