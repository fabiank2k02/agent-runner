import { LiquidGlassPanel } from "./LiquidGlassPanel.jsx";

export function PlaceholderPage({ route }) {
  return (
    <section className={`placeholder-page placeholder-${route}`}>
      <LiquidGlassPanel className="placeholder-card">
        <span className="placeholder-mark" aria-hidden="true" />
        <h1>Not implemented yet</h1>
      </LiquidGlassPanel>
    </section>
  );
}
