import { PulseGraph } from "./PulseGraph.jsx";

export function SubgoalProgressBar({ label, eta }) {
  return (
    <section className="subgoal-progress-bar">
      <div>
        <span>Current subgoal</span>
        <strong>{label}</strong>
      </div>
      <PulseGraph values={[42, 51, 48, 56, 54, 62, 58, 65, 61, 68, 63, 66]} />
      <span className="subgoal-eta">ETA&nbsp; {eta}</span>
    </section>
  );
}
