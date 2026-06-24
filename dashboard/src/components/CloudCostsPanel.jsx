import { Box, ChevronDown, Clock3, Database, Folder, Info } from "lucide-react";
import { LiquidGlassPanel } from "./LiquidGlassPanel.jsx";
import { Sparkline } from "./Sparkline.jsx";

export function CloudCostsPanel({ cloud }) {
  const spendDelta = formatDelta(cloud.spendDelta);
  return (
    <LiquidGlassPanel className={`bottom-panel cloud-costs-panel ${cloud?.unavailable ? "is-unavailable" : ""}`} delay={0.13}>
      <div className="panel-title-row">
        <h2>Cloud costs</h2>
        <Info size={16} strokeWidth={1.8} />
        <button className="tiny-select" type="button">Today <ChevronDown size={13} strokeWidth={1.8} /></button>
      </div>
      <div className="cloud-metric-row">
        <CloudMetric icon={Database} label="R2 storage" value={cloud.storage} delta={cloud.storageDelta} />
        <CloudMetric icon={Folder} label="Snapshots" value={cloud.snapshots} delta={cloud.snapshotsDelta} />
        <CloudMetric icon={Box} label="Running pods" value={cloud.runningPods} delta={cloud.runningPodsDelta} />
        <CloudMetric icon={Clock3} label="Pod hours" value={cloud.podHours} delta={cloud.podHoursDelta} />
      </div>
      <div className="cloud-total-row">
        <span>Total spend</span>
        <strong>{cloud.totalSpend}</strong>
        <em className={`delta delta-${spendDelta.tone}`}>{spendDelta.text}</em>
        <Sparkline values={cloud.spark} tone="violet" />
      </div>
    </LiquidGlassPanel>
  );
}

function CloudMetric({ icon: Icon, label, value, delta }) {
  const formattedDelta = formatDelta(delta);
  return (
    <div className="cloud-metric">
      <Icon size={21} strokeWidth={1.65} />
      <span>{label}</span>
      <strong>{value}</strong>
      <small className={`delta delta-${formattedDelta.tone}`}>{formattedDelta.text}</small>
    </div>
  );
}

function formatDelta(delta) {
  if (delta && typeof delta === "object") {
    return {
      text: `${delta.prefix || ""}${delta.label || "Unavailable"}`,
      tone: delta.tone || "neutral"
    };
  }
  const raw = String(delta || "Unavailable").trim();
  if (!raw || /^(unavailable|no data|none)$/i.test(raw)) {
    return { text: "Unavailable", tone: "neutral" };
  }
  if (/estimate|estimated|from running jobs|selected job|indexed/i.test(raw)) {
    return { text: raw.replace(/^\w/, (letter) => letter.toUpperCase()), tone: "info" };
  }
  return { text: `↑ ${raw}`, tone: "positive" };
}
