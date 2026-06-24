import { BookOpen, Box, Cpu, Database } from "lucide-react";
import { LiquidGlassPanel } from "./LiquidGlassPanel.jsx";
import { MetricCell } from "./MetricCell.jsx";
import { ContractGoalList } from "./ContractGoalList.jsx";
import { SideCardGlass3D } from "./SideCardGlass3D.jsx";

const iconMap = {
  book: BookOpen,
  cube: Box,
  cpu: Cpu,
  database: Database
};

export function CarouselSideCard({ job, position, onSelect }) {
  const Icon = iconMap[job?.icon] || Box;
  return (
    <LiquidGlassPanel
      as="button"
      type="button"
      className={`carousel-side-card ${position} has-3d-shell`}
      onClick={() => onSelect(job.id)}
      aria-label={`Select ${job.title}`}
    >
      <SideCardGlass3D position={position} />
      <div className="side-card-head">
        <span className="job-glyph">
          <Icon size={24} strokeWidth={1.7} />
        </span>
        <div>
          <strong>{job.title}</strong>
          <span>{job.branch}</span>
        </div>
      </div>
      <div className="side-status-row">
        {job.actionLabel ? <span className="action-pill">{job.actionLabel}</span> : <StatusChip job={job} />}
        <time>{job.actionTime}</time>
      </div>
      <div className="side-metric-grid">
        <MetricCell label="Elapsed" value={job.elapsed} type="elapsed" compact />
        <MetricCell label="ETA" value={job.eta} type="eta" compact />
        <MetricCell label="Total" value={`${job.completion ?? 0}%`} type="completion" percent={job.completion} compact />
        <MetricCell label="Goals" value={`${job.remaining ?? 0} goals`} type="remaining" compact />
      </div>
      <section className="side-goals">
        <h3>Contract goals</h3>
        <ContractGoalList goals={job.goals} compact limit={2} />
      </section>
      <div className="side-total">
        <span>Total completion</span>
        <div className="thin-meter"><i style={{ width: `${job.completion ?? 0}%` }} /></div>
        <strong>{job.completion ?? 0}%</strong>
      </div>
    </LiquidGlassPanel>
  );
}

function StatusChip({ job }) {
  return (
    <span className={`status-chip status-${job.status}`}>
      <i />
      {job.statusLabel}
    </span>
  );
}
