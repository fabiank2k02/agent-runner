import { ChevronRight, Check } from "lucide-react";
import { ProgressRing } from "./ProgressRing.jsx";

export function ContractGoalList({ goals = [], compact = false, limit = 5 }) {
  const visible = goals.slice(0, limit);
  if (!visible.length) {
    return (
      <div className={`contract-goal-list ${compact ? "is-compact" : ""}`}>
        <div className="contract-goal-row is-unavailable">
          <span className="goal-state-orb" />
          <div>
            <strong>Contract goals not reported</strong>
            <span>No structured goals have arrived from telemetry.</span>
          </div>
          <em>Unavailable</em>
        </div>
      </div>
    );
  }
  return (
    <div className={`contract-goal-list ${compact ? "is-compact" : ""}`}>
      {visible.map((goal) => (
        <div key={goal.id} className={`contract-goal-row state-${goal.state}`}>
          <span className="goal-state-orb">
            {goal.state === "complete" ? <Check size={17} strokeWidth={2.2} /> : <ProgressRing value={goal.percent ?? 0} size={28} stroke={4} mini />}
          </span>
          <div>
            <strong title={goal.label}>{goal.label}</strong>
            {compact ? null : <span className="goal-state-label">{formatState(goal.state)}</span>}
          </div>
          <em>{goal.state === "complete" ? "100%" : `${Math.round(goal.percent ?? 0)}%`}</em>
          <ChevronRight className="goal-chevron" size={18} strokeWidth={1.8} />
        </div>
      ))}
    </div>
  );
}

function formatState(value) {
  if (value === "complete") return "Complete";
  if (value === "active") return "Active";
  if (value === "blocked") return "Blocked";
  return "Pending";
}
