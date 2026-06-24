import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AppShell } from "./components/AppShell.jsx";
import { NowPage } from "./pages/NowPage.jsx";
import { PlaceholderPage } from "./components/PlaceholderPage.jsx";
import { DesignLab } from "./pages/DesignLab.jsx";
import { fetchDashboardData } from "./api/client.js";
import { designDashboardData, emptyDesignDashboardData } from "./data/designData.js";
import { normalizeLiveDashboardData } from "./data/normalize.js";

export const routes = [
  { id: "now", label: "Now" },
  { id: "code", label: "Code" },
  { id: "jobs", label: "Jobs" },
  { id: "cloud", label: "Cloud" },
  { id: "review", label: "Review" },
  { id: "usage", label: "Usage" }
];

const routeIds = new Set(routes.map((route) => route.id));

export default function App() {
  const [route, setRouteState] = useState(routeFromHash());
  const [designMode, setDesignMode] = useState(initialDesignMode);
  const [designVariant, setDesignVariant] = useState(initialDesignVariant);
  const [liveData, setLiveData] = useState(null);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  useEffect(() => {
    const onHashChange = () => setRouteState(routeFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("design") === "1") {
      localStorage.setItem("agent-runner-dashboard-design-mode", "1");
      setDesignMode(true);
      setDesignVariant("populated");
    } else if (params.get("design") === "empty") {
      localStorage.setItem("agent-runner-dashboard-design-mode", "1");
      setDesignMode(true);
      setDesignVariant("empty");
    } else if (params.get("design") === "0") {
      localStorage.removeItem("agent-runner-dashboard-design-mode");
      setDesignMode(false);
      setDesignVariant("populated");
    }
  }, []);

  useEffect(() => {
    if (designMode) {
      setError(null);
      setLoading(false);
      setLastUpdatedAt(new Date("2026-06-23T16:42:00Z"));
      return undefined;
    }

    let cancelled = false;
    let timer = null;
    const load = async ({ quiet = false } = {}) => {
      if (!quiet) {
        setLoading(true);
      }
      setError(null);
      try {
        const data = await fetchDashboardData();
        if (!cancelled) {
          setLiveData(normalizeLiveDashboardData(data));
          setLastUpdatedAt(new Date());
        }
      } catch (loadError) {
        if (!cancelled) {
          setLiveData(normalizeLiveDashboardData(null));
          setError(loadError);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();
    timer = window.setInterval(() => load({ quiet: true }), 15000);
    return () => {
      cancelled = true;
      if (timer) {
        window.clearInterval(timer);
      }
    };
  }, [designMode]);

  const dashboardData = useMemo(
    () => (designMode ? designDataForVariant(designVariant) : liveData || normalizeLiveDashboardData(null)),
    [designMode, designVariant, liveData]
  );

  const selectedJob = useMemo(() => {
    const jobs = dashboardData.jobs || [];
    return jobs.find((job) => job.id === selectedJobId) || jobs.find((job) => job.featured) || jobs[0] || null;
  }, [dashboardData.jobs, selectedJobId]);

  const setRoute = (nextRoute) => {
    const normalized = routeIds.has(nextRoute) ? nextRoute : "now";
    window.location.hash = normalized;
    setRouteState(normalized);
  };

  const shellState = {
    route,
    routes,
    designMode,
    loading,
    error,
    lastUpdatedAt,
    onRouteChange: setRoute
  };

  const page = route === "now"
    ? (
        <NowPage
          data={dashboardData}
          selectedJob={selectedJob}
          selectedJobId={selectedJob?.id}
          onSelectJob={setSelectedJobId}
          mode={designMode ? "design" : "live"}
        />
      )
    : <PlaceholderPage route={route} />;

  if (route === "design-lab") {
    return <DesignLab data={designDataForVariant(designVariant)} onRouteChange={setRoute} />;
  }

  return (
    <AppShell {...shellState}>
      <AnimatePresence mode="wait">
        <motion.div
          key={`${route}-${designMode ? "design" : "live"}`}
          className="route-frame"
          initial={{ opacity: 0, y: 12, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
          transition={{ duration: 0.28, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {page}
        </motion.div>
      </AnimatePresence>
    </AppShell>
  );
}

function initialDesignMode() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("design") === "1") return true;
  if (params.get("design") === "empty") return true;
  if (params.get("design") === "0") return false;
  return localStorage.getItem("agent-runner-dashboard-design-mode") === "1";
}

function initialDesignVariant() {
  const params = new URLSearchParams(window.location.search);
  return params.get("design") === "empty" ? "empty" : "populated";
}

function designDataForVariant(variant) {
  return variant === "empty" ? emptyDesignDashboardData : designDashboardData;
}

function routeFromHash() {
  const raw = window.location.hash.replace(/^#\/?/, "").toLowerCase();
  if (raw === "design-lab") return raw;
  return routeIds.has(raw) ? raw : "now";
}
