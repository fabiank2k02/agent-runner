import { useId } from "react";
import { Box, Copy, GitBranch } from "lucide-react";
import { LiquidGlassPanel } from "./LiquidGlassPanel.jsx";
import { MetricCell } from "./MetricCell.jsx";
import { SubgoalProgressBar } from "./SubgoalProgressBar.jsx";
import { ContractGoalList } from "./ContractGoalList.jsx";

export function HeroJobCard({ job }) {
  if (!job) {
    return (
      <LiquidGlassPanel className="hero-job-card is-empty is-skeleton-card">
        <div className="hero-topline">
          <span className="live-dot status-unavailable" />
          <span className="skeleton-line w-22" />
          <span className="hero-job-id skeleton-line w-18" />
          <span className="status-chip status-unavailable"><i />No data</span>
        </div>
        <div className="hero-title-row">
          <div>
            <h1><span className="skeleton-line w-44" /></h1>
            <p><GitBranch size={18} strokeWidth={1.7} /><span className="skeleton-line w-32" /><Copy size={17} strokeWidth={1.65} /></p>
          </div>
          <div className="hero-action-stack">
            <span className="review-pill skeleton-pill" />
            <time className="skeleton-line w-14" />
          </div>
        </div>
        <div className="hero-metrics">
          <SkeletonMetric />
          <SkeletonMetric />
          <SkeletonMetric />
          <SkeletonMetric />
        </div>
        <div className="subgoal-progress-bar skeleton-subgoal">
          <div>
            <span>Current subgoal</span>
            <strong><span className="skeleton-line w-40" /></strong>
          </div>
          <span className="skeleton-wave" />
          <span className="subgoal-eta">ETA&nbsp;&nbsp;<span className="skeleton-line w-10" /></span>
        </div>
        <div className="hero-body">
          <div className="completion-feature skeleton-completion">
            <span className="skeleton-ring" />
            <strong><span className="skeleton-line w-18" /></strong>
            <span>Total completion</span>
          </div>
          <section className="hero-goals">
            <div className="panel-title-row">
              <h2>Contract goals</h2>
              <span>No data</span>
            </div>
            <div className="contract-goal-list">
              <SkeletonGoal />
              <SkeletonGoal />
              <SkeletonGoal />
              <SkeletonGoal />
            </div>
          </section>
        </div>
      </LiquidGlassPanel>
    );
  }
  return (
    <LiquidGlassPanel className={`hero-job-card status-${job.status}`}>
      <div className="hero-topline">
        <span className={`live-dot status-${job.status}`} />
        <span>{job.status === "running" ? "Active job" : "Selected job"}</span>
        <span className="hero-job-id">Job ID: {job.shortId}</span>
        <StatusChip job={job} />
      </div>
      <div className="hero-title-row">
        <div>
          <h1>{job.title}</h1>
          <p><GitBranch size={18} strokeWidth={1.7} />{job.branch}<Copy size={17} strokeWidth={1.65} /></p>
        </div>
        <div className="hero-action-stack">
          {job.actionLabel ? <button className="review-pill" type="button">{job.actionLabel}</button> : null}
          <time>{job.actionTime}</time>
        </div>
      </div>
      <div className="hero-metrics">
        <MetricCell label="Elapsed" value={job.elapsed} type="elapsed" />
        <MetricCell label="ETA" value={job.eta} type="eta" />
        <MetricCell label="Total completion" value={`${job.completion ?? 0}%`} type="completion" percent={job.completion} />
        <MetricCell label="Remaining" value={`${job.remaining ?? 0} goals`} type="remaining" />
      </div>
      <SubgoalProgressBar label={job.currentSubgoal} eta={job.currentEta} />
      <div className="hero-body">
        <div className="completion-feature">
          <HeroCompletionGauge value={job.completion} />
          <strong>{job.completion ?? 0}%</strong>
          <span>Total completion</span>
        </div>
        <section className="hero-goals">
          <div className="panel-title-row">
            <h2>Contract goals</h2>
            <span>{job.remaining ?? 0} remaining</span>
          </div>
          <ContractGoalList goals={job.goals} limit={5} />
        </section>
      </div>
    </LiquidGlassPanel>
  );
}

function SkeletonMetric() {
  return (
    <div className="metric-cell skeleton-metric">
      <span className="metric-icon"><Box size={18} strokeWidth={1.6} /></span>
      <span className="skeleton-line w-16" />
      <strong><span className="skeleton-line w-20" /></strong>
    </div>
  );
}

function HeroCompletionGauge({ value }) {
  const id = useId().replace(/:/g, "");
  const numeric = typeof value === "number" ? Math.max(0, Math.min(100, value)) : 0;
  const visualLength = Math.min(100, numeric + 24);
  const path = "M64 24 C111 25 151 62 158 108 C162 134 150 158 130 174";
  return (
    <span className="hero-completion-gauge" aria-hidden="true">
      <svg viewBox="0 0 178 188" preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id={`hero-gauge-${id}`} x1="18%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#48b7ff" />
            <stop offset="52%" stopColor="#706dff" />
            <stop offset="100%" stopColor="#52dcff" />
          </linearGradient>
          <filter id={`hero-gauge-glow-${id}`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="2.7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path className="hero-gauge-track" d="M48 171 C80 185 121 183 146 162" />
        <path
          className="hero-gauge-value"
          d={path}
          pathLength="100"
          strokeDasharray={`${visualLength} 100`}
          stroke={`url(#hero-gauge-${id})`}
          filter={`url(#hero-gauge-glow-${id})`}
        />
      </svg>
    </span>
  );
}

function SkeletonGoal() {
  return (
    <div className="contract-goal-row skeleton-goal">
      <span className="goal-state-orb"><span className="skeleton-dot" /></span>
      <strong><span className="skeleton-line w-52" /></strong>
      <em><span className="skeleton-line w-12" /></em>
      <span className="goal-chevron" />
    </div>
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
