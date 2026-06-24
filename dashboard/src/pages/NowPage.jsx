import { JobCarousel } from "../components/JobCarousel.jsx";
import { UsagePanel } from "../components/UsagePanel.jsx";
import { CloudCostsPanel } from "../components/CloudCostsPanel.jsx";
import { ProcessorPanel } from "../components/ProcessorPanel.jsx";

export function NowPage({ data, selectedJob, selectedJobId, onSelectJob, mode }) {
  return (
    <section className={`now-page now-${mode}`} data-testid="now-page">
      <JobCarousel
        jobs={data.jobs}
        selectedJob={selectedJob}
        selectedJobId={selectedJobId}
        onSelectJob={onSelectJob}
      />
      <section className="bottom-instruments" aria-label="Usage, cloud costs, and processor">
        <UsagePanel usage={data.usage} />
        <CloudCostsPanel cloud={data.cloud} />
        <ProcessorPanel processor={data.processor} />
      </section>
    </section>
  );
}
