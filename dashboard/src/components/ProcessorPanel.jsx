import { Box, ChevronDown, ChevronRight, Info } from "lucide-react";
import { LiquidGlassPanel } from "./LiquidGlassPanel.jsx";

export function ProcessorPanel({ processor }) {
  const healthTone = statusTone(processor.health);
  const leaseTone = statusTone(processor.lease);
  return (
    <LiquidGlassPanel className={`bottom-panel processor-panel ${processor?.unavailable ? "is-unavailable" : ""}`} delay={0.18}>
      <div className="panel-title-row">
        <h2>Processor</h2>
        <Info size={16} strokeWidth={1.8} />
        <button className="tiny-select" type="button">{processor.mode} <ChevronRight size={13} strokeWidth={1.8} /></button>
      </div>
      <div className="processor-select-row">
        <span className="job-glyph"><Box size={24} strokeWidth={1.7} /></span>
        <div>
          <span>Processor</span>
          <strong>{processor.selected}</strong>
        </div>
        <ChevronDown size={20} strokeWidth={1.8} />
      </div>
      <div className="processor-health-row">
        <span>Health <strong className={`status-dot tone-${healthTone}`}>{processor.health}</strong></span>
        <span>Lease <strong className={`status-dot tone-${leaseTone}`}>{processor.lease}</strong></span>
      </div>
      <div className="processor-metrics">
        <div><span>Pending streams</span><strong>{processor.pendingStreams}</strong></div>
        <div><span>Behind</span><strong>{processor.behind}</strong></div>
        <div><span>Last run</span><strong>{processor.lastRun}</strong></div>
      </div>
    </LiquidGlassPanel>
  );
}

function statusTone(value) {
  const normalized = String(value || "").toLowerCase();
  if (["healthy", "active", "running", "ready"].includes(normalized)) return "good";
  if (["lagging", "stale", "waiting", "paused", "expired"].includes(normalized)) return "warn";
  if (["failed", "error", "blocked", "unhealthy"].includes(normalized)) return "bad";
  return "neutral";
}
