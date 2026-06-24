import { ChevronLeft, ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { CarouselSideCard } from "./CarouselSideCard.jsx";
import { HeroJobCard } from "./HeroJobCard.jsx";
import { SideCardGlass3D } from "./SideCardGlass3D.jsx";

export function JobCarousel({ jobs = [], selectedJob, selectedJobId, onSelectJob }) {
  const hasJobs = jobs.length > 0;
  const activeId = selectedJobId || selectedJob?.id;
  const selectedIndex = Math.max(0, jobs.findIndex((job) => job.id === activeId));
  const previous = jobs[selectedIndex - 1] || jobs[selectedIndex + 2] || null;
  const next = jobs[selectedIndex + 1] || jobs[selectedIndex - 2] || null;

  const selectRelative = (direction) => {
    if (!jobs.length) return;
    const nextIndex = (selectedIndex + direction + jobs.length) % jobs.length;
    onSelectJob(jobs[nextIndex].id);
  };

  return (
    <section className="job-carousel" aria-label="Current jobs">
      {previous ? <CarouselSideCard job={previous} position="left" onSelect={onSelectJob} /> : <CarouselSideSkeleton position="left" />}
      <AnimatePresence mode="wait">
        <motion.div
          key={selectedJob?.id || "empty"}
          className="hero-motion-wrap"
          initial={{ opacity: 0, scale: 0.975, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.985, y: -8 }}
          transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <HeroJobCard job={selectedJob} />
        </motion.div>
      </AnimatePresence>
      {next ? <CarouselSideCard job={next} position="right" onSelect={onSelectJob} /> : <CarouselSideSkeleton position="right" />}
      <button className="carousel-arrow arrow-left" type="button" onClick={() => selectRelative(-1)} aria-label="Previous job" disabled={!hasJobs || jobs.length < 2}>
        <ChevronLeft size={23} strokeWidth={1.8} />
      </button>
      <button className="carousel-arrow arrow-right" type="button" onClick={() => selectRelative(1)} aria-label="Next job" disabled={!hasJobs || jobs.length < 2}>
        <ChevronRight size={23} strokeWidth={1.8} />
      </button>
      <div className="carousel-dots" aria-label="Job carousel position">
        {(hasJobs ? jobs.slice(0, 7) : skeletonDots()).map((job, index) => (
          <button
            key={job.id}
            className={job.id === selectedJob?.id ? "is-active" : ""}
            type="button"
            aria-label={hasJobs ? `Select ${job.title}` : `Skeleton page ${index + 1}`}
            disabled={!hasJobs}
            onClick={() => hasJobs && onSelectJob(job.id)}
          />
        ))}
      </div>
    </section>
  );
}

function skeletonDots() {
  return Array.from({ length: 5 }, (_, index) => ({ id: `skeleton-dot-${index}` }));
}

function CarouselSideSkeleton({ position }) {
  return (
    <div className={`liquid-glass-panel carousel-side-card ${position} has-3d-shell is-skeleton-card`} aria-hidden="true">
      <SideCardGlass3D position={position} />
      <div className="glass-content">
        <div className="side-card-head">
          <span className="job-glyph skeleton-glyph" />
          <div>
            <strong><span className="skeleton-line w-30" /></strong>
            <span className="skeleton-line w-24" />
          </div>
        </div>
        <div className="side-status-row">
          <span className="status-chip status-unavailable"><i />No data</span>
          <time className="skeleton-line w-12" />
        </div>
        <div className="side-metric-grid">
          <span className="metric-cell is-compact skeleton-metric" />
          <span className="metric-cell is-compact skeleton-metric" />
          <span className="metric-cell is-compact skeleton-metric" />
          <span className="metric-cell is-compact skeleton-metric" />
        </div>
        <section className="side-goals">
          <h3>Contract goals</h3>
          <div className="contract-goal-list is-compact">
            <span className="contract-goal-row skeleton-goal" />
            <span className="contract-goal-row skeleton-goal" />
          </div>
        </section>
        <div className="side-total">
          <span>Total completion</span>
          <div className="thin-meter"><i style={{ width: "0%" }} /></div>
          <strong>No data</strong>
        </div>
      </div>
    </div>
  );
}
