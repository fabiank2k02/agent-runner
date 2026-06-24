import { Clock3, Hourglass, ListChecks, TimerReset } from "lucide-react";
import { ProgressRing } from "./ProgressRing.jsx";

const iconMap = {
  elapsed: Clock3,
  eta: Hourglass,
  completion: TimerReset,
  remaining: ListChecks
};

export function MetricCell({ label, value, type = "elapsed", percent = null, compact = false }) {
  const Icon = iconMap[type] || Clock3;
  return (
    <div className={`metric-cell ${compact ? "is-compact" : ""}`}>
      <span className="metric-icon" aria-hidden="true">
        {type === "completion" ? <ProgressRing value={percent} size={24} stroke={3} mini /> : <Icon size={19} strokeWidth={1.7} />}
      </span>
      <span title={label}>{label}</span>
      <strong title={String(value)}>{value}</strong>
    </div>
  );
}
