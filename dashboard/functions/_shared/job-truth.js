const terminalStatuses = new Set(["completed", "failed", "stopped", "timed-out"]);

export function classifyJob(row, options = {}) {
  const env = options.env || {};
  const nowMs = options.now instanceof Date ? options.now.getTime() : Number.isFinite(options.now) ? options.now : Date.now();
  const reportedStatus = String(row.status || "unknown");
  const startedMs = timestampMs(row.started_at);
  const latestSignalAt = row.last_raw_telemetry_at || row.updated_at || row.last_seen_at || null;
  const signalMs = timestampMs(latestSignalAt);
  const staleSeconds = positiveInteger(env.AGENT_RUNNER_JOB_STALE_SECONDS, 20 * 60);
  const timeoutSeconds = positiveInteger(env.AGENT_RUNNER_JOB_TIMEOUT_SECONDS, 12 * 60 * 60);
  const signalAgeSeconds = signalMs === null ? null : Math.max(0, Math.round((nowMs - signalMs) / 1000));
  const runtimeSeconds = startedMs === null ? null : Math.max(0, Math.round((nowMs - startedMs) / 1000));
  const text = `${reportedStatus} ${row.current_activity || ""} ${row.summary_json || ""} ${row.status_json || ""}`.toLowerCase();

  if (reportedStatus === "completed" || reportedStatus === "stopped" || reportedStatus === "failed") {
    return result(reportedStatus, reportedStatus, reportedStatus, "terminal status reported", {
      reportedStatus,
      latestSignalAt,
      signalAgeSeconds,
      runtimeSeconds,
      staleSeconds,
      timeoutSeconds
    });
  }
  if (Number(row.exit_code) > 0 || /failed|exception|fatal error/u.test(text)) {
    return result("failed", "failed", "failed", "failure signal reported", {
      reportedStatus,
      latestSignalAt,
      signalAgeSeconds,
      runtimeSeconds,
      staleSeconds,
      timeoutSeconds
    });
  }
  if (runtimeSeconds !== null && runtimeSeconds > timeoutSeconds) {
    return result("timed-out", "timed-out", "timeout", `runtime exceeded ${timeoutSeconds}s`, {
      reportedStatus,
      latestSignalAt,
      signalAgeSeconds,
      runtimeSeconds,
      staleSeconds,
      timeoutSeconds
    });
  }
  if (signalAgeSeconds !== null && signalAgeSeconds > staleSeconds) {
    return result("stale", "signal-lost", "stale", `no telemetry for ${signalAgeSeconds}s`, {
      reportedStatus,
      latestSignalAt,
      signalAgeSeconds,
      runtimeSeconds,
      staleSeconds,
      timeoutSeconds
    });
  }
  if (/ready to resume|resume requested|can resume/u.test(text)) {
    return result("ready-to-resume", "ready-to-resume", "ready", "resume signal reported", {
      reportedStatus,
      latestSignalAt,
      signalAgeSeconds,
      runtimeSeconds,
      staleSeconds,
      timeoutSeconds
    });
  }
  if (/blocked|cannot proceed|waiting on secret|needs approval/u.test(text)) {
    return result("blocked", "blocked", "blocked", "blocker signal reported", {
      reportedStatus,
      latestSignalAt,
      signalAgeSeconds,
      runtimeSeconds,
      staleSeconds,
      timeoutSeconds
    });
  }
  if (/waiting|queued|pending/u.test(text)) {
    return result("waiting", "waiting", "waiting", "waiting signal reported", {
      reportedStatus,
      latestSignalAt,
      signalAgeSeconds,
      runtimeSeconds,
      staleSeconds,
      timeoutSeconds
    });
  }
  return result(reportedStatus, reportedStatus, "active", "latest reported status", {
    reportedStatus,
    latestSignalAt,
    signalAgeSeconds,
    runtimeSeconds,
    staleSeconds,
    timeoutSeconds
  });
}

export function isTerminalJobStatus(status) {
  return terminalStatuses.has(status);
}

function result(status, label, category, reason, details) {
  return {
    status,
    label,
    category,
    reason,
    reportedStatus: details.reportedStatus,
    terminal: terminalStatuses.has(status),
    latestSignalAt: details.latestSignalAt,
    signalAgeSeconds: details.signalAgeSeconds,
    runtimeSeconds: details.runtimeSeconds,
    staleSeconds: details.staleSeconds,
    timeoutSeconds: details.timeoutSeconds
  };
}

function timestampMs(value) {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
