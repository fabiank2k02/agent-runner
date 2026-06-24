import { AppShell } from "../components/AppShell.jsx";
import { LiquidNav } from "../components/LiquidNav.jsx";
import { ProgressRing } from "../components/ProgressRing.jsx";
import { Sparkline } from "../components/Sparkline.jsx";
import { PulseGraph } from "../components/PulseGraph.jsx";
import { HeroJobCard } from "../components/HeroJobCard.jsx";
import { CarouselSideCard } from "../components/CarouselSideCard.jsx";
import { UsagePanel } from "../components/UsagePanel.jsx";
import { CloudCostsPanel } from "../components/CloudCostsPanel.jsx";
import { ProcessorPanel } from "../components/ProcessorPanel.jsx";
import { routes } from "../App.jsx";

export function DesignLab({ data, onRouteChange }) {
  const hero = data.jobs.find((job) => job.featured) || data.jobs[0];
  return (
    <AppShell
      route="now"
      routes={routes}
      designMode
      loading={false}
      error={null}
      lastUpdatedAt={new Date("2026-06-23T16:42:00Z")}
      onRouteChange={onRouteChange}
    >
      <section className="design-lab">
        <div className="design-lab-strip">
          <LiquidNav routes={routes} activeRoute="now" onRouteChange={() => {}} />
          <ProgressRing value={76} />
          <Sparkline values={data.usage.spark} />
          <PulseGraph values={data.usage.pulse} />
        </div>
        <div className="design-lab-grid">
          <HeroJobCard job={hero} />
          <CarouselSideCard job={data.jobs[0]} position="left" onSelect={() => {}} />
          <UsagePanel usage={data.usage} />
          <CloudCostsPanel cloud={data.cloud} />
          <ProcessorPanel processor={data.processor} />
        </div>
      </section>
    </AppShell>
  );
}
