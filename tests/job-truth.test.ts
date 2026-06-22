import { describe, expect, it } from "vitest";
import { classifyJob } from "../dashboard/functions/_shared/job-truth.js";

describe("job truth classification", () => {
  it("marks timeout jobs as timed-out instead of running forever", () => {
    const truth = classifyJob(
      {
        status: "running",
        started_at: "2026-06-18T00:00:00.000Z",
        updated_at: "2026-06-18T00:10:00.000Z",
        last_raw_telemetry_at: "2026-06-18T00:10:00.000Z",
        current_activity: "Running"
      },
      {
        now: Date.parse("2026-06-18T02:00:00.000Z"),
        env: { AGENT_RUNNER_JOB_TIMEOUT_SECONDS: "3600", AGENT_RUNNER_JOB_STALE_SECONDS: "999999" }
      }
    );

    expect(truth.status).toBe("timed-out");
    expect(truth.reportedStatus).toBe("running");
    expect(truth.terminal).toBe(true);
  });

  it("marks missing telemetry as stale when the timeout window has not elapsed", () => {
    const truth = classifyJob(
      {
        status: "running",
        started_at: "2026-06-18T01:50:00.000Z",
        updated_at: "2026-06-18T01:50:00.000Z",
        last_raw_telemetry_at: "2026-06-18T01:50:00.000Z",
        current_activity: "Running"
      },
      {
        now: Date.parse("2026-06-18T02:00:00.000Z"),
        env: { AGENT_RUNNER_JOB_TIMEOUT_SECONDS: "3600", AGENT_RUNNER_JOB_STALE_SECONDS: "300" }
      }
    );

    expect(truth.status).toBe("stale");
    expect(truth.label).toBe("signal-lost");
  });

  it("promotes nonzero exits to failed", () => {
    const truth = classifyJob({
      status: "running",
      exit_code: 2,
      updated_at: "2026-06-18T02:00:00.000Z",
      current_activity: "Command exited"
    });

    expect(truth.status).toBe("failed");
  });
});
