import { Info } from "lucide-react";
import { LiquidGlassPanel } from "./LiquidGlassPanel.jsx";
import { ProgressRing } from "./ProgressRing.jsx";
import { Sparkline } from "./Sparkline.jsx";

export function UsagePanel({ usage }) {
  const costDelta = formatDelta(usage.costDelta, { suffix: " vs yesterday" });
  return (
    <LiquidGlassPanel className={`bottom-panel usage-panel ${usage?.unavailable ? "is-unavailable" : ""}`} delay={0.08}>
      <div className="panel-title-row">
        <h2>Usage</h2>
        <Info size={16} strokeWidth={1.8} />
      </div>
      <div className="usage-grid">
        <div className="allowance-block">
          <span>Codex allowance</span>
          <ProgressRing value={usage.allowancePercent ?? 0} size={112} stroke={10} label={usage.allowanceLabel} tone="usage" />
          <small>{usage.allowanceDetail}</small>
        </div>
        <div className="token-block">
          <div className="token-heading">
            <span>Token pulse</span>
            <button className="tiny-select" type="button">24h</button>
          </div>
          <Sparkline values={usage.pulse} tone="cyan" />
          <strong>{usage.tokenPulse}</strong>
          <small>{usage.tokenPulseUnit}</small>
        </div>
        <div className="cost-block">
          <span>Cost today</span>
          <strong>{usage.costToday}</strong>
          <Sparkline values={usage.spark} tone="amber" />
          <small className={`delta delta-${costDelta.tone}`}>{costDelta.text}</small>
        </div>
      </div>
    </LiquidGlassPanel>
  );
}

function formatDelta(delta, options = {}) {
  if (delta && typeof delta === "object") {
    const label = delta.label || "Unavailable";
    const suffix = /^(unavailable|no data|none)$/i.test(label) ? "" : delta.suffix || options.suffix || "";
    return {
      text: `${delta.prefix || ""}${label}${suffix}`,
      tone: delta.tone || "neutral"
    };
  }
  const raw = String(delta || "Unavailable").trim();
  if (!raw || /^(unavailable|no data|none)$/i.test(raw)) {
    return { text: "Unavailable", tone: "neutral" };
  }
  if (/^(selected job|estimated|estimate)$/i.test(raw)) {
    return { text: raw.replace(/^\w/, (letter) => letter.toUpperCase()), tone: "neutral" };
  }
  return { text: `↑ ${raw}${options.suffix || ""}`, tone: "positive" };
}
