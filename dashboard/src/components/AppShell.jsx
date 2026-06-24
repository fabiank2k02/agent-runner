import { Bell, Search } from "lucide-react";
import { AgentRunnerLogo } from "./AgentRunnerLogo.jsx";
import { LiquidNav } from "./LiquidNav.jsx";

export function AppShell({
  children,
  route,
  routes,
  designMode,
  loading,
  error,
  lastUpdatedAt,
  onRouteChange
}) {
  return (
    <div className="app-shell">
      <div className="background-plane" aria-hidden="true" />
      <header className="global-header">
        <AgentRunnerLogo />
        <LiquidNav routes={routes} activeRoute={route} onRouteChange={onRouteChange} />
        <div className="utility-cluster" aria-label="Dashboard utilities">
          <button className="icon-shell" type="button" aria-label="Search" disabled>
            <Search size={22} strokeWidth={1.8} />
          </button>
          <button className="icon-shell" type="button" aria-label="Notifications" disabled>
            <Bell size={21} strokeWidth={1.8} />
          </button>
          <span className="profile-orb" aria-label="Profile">
            <span>AR</span>
            <i />
          </span>
        </div>
      </header>
      <main className="app-main">
        {!designMode && (error || loading) ? (
          <div className="page-state-bar" data-loading={loading ? "true" : "false"}>
            <span>{error ? "Dashboard data unavailable" : "Loading dashboard data"}</span>
            <strong>{error ? error.message || String(error) : "Refreshing"}</strong>
          </div>
        ) : null}
        {designMode ? (
          <span className="design-mode-tag">Design mode</span>
        ) : lastUpdatedAt ? (
          <span className="live-mode-tag">Updated {formatTime(lastUpdatedAt)}</span>
        ) : null}
        {children}
      </main>
    </div>
  );
}

function formatTime(date) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}
