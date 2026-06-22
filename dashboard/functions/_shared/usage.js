export const WEEKS_PER_MONTH = 52 / 12;
export const WEEK_MINUTES = 7 * 24 * 60;
export const DEFAULT_CODEX_SUBSCRIPTION_USD = 100;

const methodValues = new Set(["measured", "allocated", "estimated", "unknown"]);

export function normalizeTokenUsage(value) {
  const usage = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const inputTokens = finiteNumber(usage.inputTokens ?? usage.input_tokens);
  const cachedInputTokens = finiteNumber(usage.cachedInputTokens ?? usage.cached_input_tokens);
  const outputTokens = finiteNumber(usage.outputTokens ?? usage.output_tokens);
  const reasoningOutputTokens = finiteNumber(usage.reasoningOutputTokens ?? usage.reasoning_output_tokens);
  const explicitTotal = nullableNumber(usage.totalTokens ?? usage.total_tokens ?? usage.tokens);
  const totalTokens = explicitTotal ?? inputTokens + outputTokens;
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens
  };
}

export function addTokenUsage(left = {}, right = {}) {
  const a = normalizeTokenUsage(left);
  const b = normalizeTokenUsage(right);
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningOutputTokens: a.reasoningOutputTokens + b.reasoningOutputTokens,
    totalTokens: a.totalTokens + b.totalTokens
  };
}

export function extractStreamTokenUsage(metadata = {}, payload = {}) {
  const snapshotCandidates = [
    metadata?.tokenUsage,
    metadata?.token_usage,
    payload?.tokenUsage,
    payload?.token_usage,
    payload?.thread?.tokenUsage,
    payload?.thread?.token_usage,
    payload?.codexJsonl?.tokenUsage,
    payload?.codexJsonl?.token_usage,
    payload?.telemetry?.tokenUsage,
    payload?.telemetry?.token_usage,
    payload?.telemetry?.spend,
    payload?.summary?.cost
  ];
  const deltaCandidates = [];

  for (const event of appServerEvents(payload)) {
    if (eventType(event) === "thread/tokenUsage/updated") {
      snapshotCandidates.push(event.usage, event.tokenUsage, event.token_usage, event.response?.usage, event.totals);
      if (event.delta) {
        deltaCandidates.push(event.delta);
      }
    }
  }
  for (const event of codexJsonlTokenCountEvents(payload)) {
    snapshotCandidates.push(event.tokenUsage);
  }

  return addTokenUsage(
    largestTokenUsage(snapshotCandidates),
    deltaCandidates.reduce((sum, candidate) => addTokenUsage(sum, candidate || {}), {})
  );
}

export function accountUsageSnapshotFromEnvelope(envelope, { sourceId = null, chunkId = null, sha256 = null, now = new Date().toISOString() } = {}) {
  const payload = envelope?.payload && typeof envelope.payload === "object" ? envelope.payload : {};
  const metadata = envelope?.metadata && typeof envelope.metadata === "object" ? envelope.metadata : {};
  const candidates = [
    payload.accountUsage,
    payload.account_usage,
    payload.codexAccountStatus,
    payload.codex_account_status,
    payload.codexStatus,
    payload.status?.accountUsage,
    payload.status?.codexAccountStatus,
    metadata.accountUsage,
    metadata.codexAccountStatus
  ].filter((item) => item && typeof item === "object" && !Array.isArray(item));

  for (const event of appServerEvents(payload)) {
    if (eventType(event) === "account/rateLimits/updated") {
      candidates.push(event);
    }
  }
  for (const event of codexJsonlTokenCountEvents(payload)) {
    candidates.push({
      collectedAt: event.timestamp,
      tokenUsage: event.tokenUsage,
      rateLimits: event.rateLimits,
      rawStatusFormat: "codex-jsonl-token-count"
    });
  }

  let merged = null;
  for (const candidate of candidates) {
    const normalized = normalizeAccountUsageSnapshot(candidate, {
      collectedAt: envelope?.generatedAt || now,
      source: "raw-telemetry"
    });
    if (!normalized) {
      continue;
    }
    merged = mergeAccountUsageSnapshots(merged, normalized);
  }

  if (!merged) {
    return null;
  }
  return {
    ...merged,
    collectedAt: merged.collectedAt || envelope?.generatedAt || now,
    metadata: {
      ...merged.metadata,
      sourceId,
      chunkId,
      sha256,
      source: "raw-telemetry"
    }
  };
}

export function normalizeAccountUsageSnapshot(value, defaults = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const limits = objectAt(value, "limits") || objectAt(value, "rateLimits") || objectAt(value, "rate_limits") || {};
  const windows = windowsFromRateLimits(value, limits);
  const weekly = normalizeRemaining(
    objectAt(value, "weeklyRemaining") ||
      objectAt(value, "weekly_remaining") ||
      objectAt(limits, "weekly") ||
      objectAt(limits, "weeklyRemaining") ||
      windows.weekly,
    { windowKind: "weekly" }
  );
  const rolling5h = normalizeRemaining(
    objectAt(value, "rolling5hRemaining") ||
      objectAt(value, "rolling_5h_remaining") ||
      objectAt(value, "rollingFiveHourRemaining") ||
      objectAt(limits, "rolling5h") ||
      objectAt(limits, "rolling_5h") ||
      windows.rolling5h,
    { windowKind: "rolling5h" }
  );
  const tokenUsage = normalizeTokenUsage(value.tokenUsage || value.token_usage || value.usage || {});
  const reset = normalizeReset(value, limits, weekly, rolling5h);
  const hasRateLimit = Boolean(weekly || rolling5h);
  const hasTokens = tokenUsage.totalTokens > 0;
  if (!hasRateLimit && !hasTokens) {
    return null;
  }

  return {
    collectedAt: stringValue(value.collectedAt) || stringValue(value.collected_at) || stringValue(value.timestamp) || defaults.collectedAt || null,
    weeklyRemaining: weekly,
    rolling5hRemaining: rolling5h,
    tokenUsage,
    reset,
    metadata: {
      sourceEnvironment: value.sourceEnvironment || value.source_environment || null,
      tierLabel: value.tierLabel || value.tier_label || value.accountTier || null,
      modelUsage: value.modelUsage || value.model_usage || null,
      rawStatusFormat: value.rawStatusFormat || value.raw_status_format || null,
      source: defaults.source || "unknown",
      rateLimitSource: windows.source || null
    }
  };
}

export function aggregateAccountUsageRows(rows = [], options = {}) {
  const nowMs = options.now instanceof Date ? options.now.getTime() : Number.isFinite(options.now) ? options.now : Date.now();
  const snapshots = rows
    .map(mapAccountUsageRow)
    .filter(Boolean)
    .sort((left, right) => Date.parse(right.collectedAt || "") - Date.parse(left.collectedAt || ""));
  const latest = snapshots[0] || null;
  const weekly = usageWindow(latest?.weeklyRemaining, latest?.reset?.weeklyResetAt);
  const rolling5h = usageWindow(latest?.rolling5hRemaining, latest?.reset?.rolling5hResetAt);
  const burn = {
    lastHour: burnForWindow(snapshots, nowMs, 60 * 60 * 1000),
    rolling5h: burnForWindow(snapshots, nowMs, 5 * 60 * 60 * 1000),
    week: burnForWindow(snapshots, nowMs, 7 * 24 * 60 * 60 * 1000),
    today: burnForWindow(snapshots, nowMs, 24 * 60 * 60 * 1000)
  };
  const subscription = codexSubscriptionBudget(options.env || {}, options.costs || {});

  return {
    snapshots,
    latest,
    weekly,
    rolling5h,
    burn,
    subscription,
    tokensLastHour: burn.lastHour.tokens,
    tokenBurnRatePerHour: burn.lastHour.tokensPerHour,
    tokensToday: burn.today.tokens,
    tokensThisWeek: burn.week.tokens,
    estimatedHoursUntilLimit:
      weekly?.remainingTokens != null && burn.lastHour.tokensPerHour
        ? Math.max(0, weekly.remainingTokens / burn.lastHour.tokensPerHour)
        : null,
    label: latest ? "measured" : "unknown",
    missingReason: latest ? null : "No account rate-limit or status snapshots have arrived."
  };
}

export function estimateJobCodexCost({ tokenUsage = {}, cost = {}, startedAt = null, finishedAt = null, now = Date.now(), accountUsage = null, env = {} } = {}) {
  const usage = normalizeTokenUsage(tokenUsage);
  const {
    confidence: _confidence,
    digitalOceanConfidence: _digitalOceanConfidence,
    codexAllocationConfidence: _codexAllocationConfidence,
    ...baseCost
  } = cost || {};
  const subscription = codexSubscriptionBudget(env, cost);
  const weeklyAllowance =
    positiveNumber(cost.codexWeeklyTokenAllowance) ??
    positiveNumber(env.AGENT_RUNNER_CODEX_WEEKLY_TOKEN_ALLOWANCE) ??
    positiveNumber(accountUsage?.weekly?.limitTokens) ??
    positiveNumber(accountUsage?.latest?.weeklyRemaining?.limitTokens);
  const weeklyBudget = positiveNumber(subscription.weeklyBudgetUsd);
  const elapsedMinutes = elapsedMinutesBetween(startedAt, finishedAt, now);
  const existingDoCost = nullableNumber(cost.digitalOceanCostUsd);

  let codexCostUsd = null;
  let codexCostMethod = "unknown";
  let codexCostSource = "missing_usage";
  let codexTokens = usage.totalTokens > 0 ? usage.totalTokens : null;
  let tokenUsageMethod = usage.totalTokens > 0 ? "measured" : "unknown";

  if (weeklyBudget !== null && usage.totalTokens > 0 && weeklyAllowance !== null) {
    codexCostUsd = weeklyBudget * (usage.totalTokens / weeklyAllowance);
    codexCostMethod = "measured";
    codexCostSource = "job_token_usage";
  } else {
    const quotaDelta = accountQuotaDelta(accountUsage);
    if (weeklyBudget !== null && quotaDelta.tokens !== null && quotaDelta.limitTokens !== null) {
      codexTokens = quotaDelta.tokens;
      tokenUsageMethod = "allocated";
      codexCostUsd = weeklyBudget * (quotaDelta.tokens / quotaDelta.limitTokens);
      codexCostMethod = "allocated";
      codexCostSource = "quota_delta";
    } else if (weeklyBudget !== null && elapsedMinutes !== null) {
      codexCostUsd = weeklyBudget * (elapsedMinutes / WEEK_MINUTES);
      codexCostMethod = "estimated";
      codexCostSource = "runtime_allocation";
    }
  }

  const knownParts = [existingDoCost, codexCostUsd].filter((value) => typeof value === "number" && Number.isFinite(value));
  const codexTaskAllocationPercent =
    codexCostUsd !== null && weeklyBudget !== null && weeklyBudget > 0
      ? (codexCostUsd / weeklyBudget) * 100
      : null;
  const codexRemainingWeeklyBudgetUsd =
    weeklyBudget === null ? null : Math.max(0, weeklyBudget - (codexCostUsd || 0));
  return {
    ...baseCost,
    ...usage,
    elapsedMinutes,
    digitalOceanCostUsd: existingDoCost,
    codexSubscriptionMonthlyUsd: subscription.monthlyUsd,
    codexSubscriptionSeatMultiplier: subscription.seatMultiplier,
    codexSubscriptionPriceMethod: subscription.priceMethod,
    codexWeeklyBudgetUsd: subscription.weeklyBudgetUsd,
    codexWeeklyBudgetFormula: subscription.formula,
    codexWeeklyTokenAllowance: weeklyAllowance,
    codexTaskAllocationUsd: codexCostUsd,
    codexTokenCostUsd: codexCostUsd,
    codexCostUsd,
    codexTaskAllocationPercent,
    codexRemainingWeeklyBudgetUsd,
    codexCostMethod,
    codexCostSource,
    codexTokens,
    tokenUsageMethod,
    totalOperationalCostUsd: knownParts.length ? knownParts.reduce((sum, value) => sum + value, 0) : null,
    totalEstimatedCostUsd: knownParts.length ? knownParts.reduce((sum, value) => sum + value, 0) : null
  };
}

export function codexSubscriptionBudget(env = {}, costs = {}) {
  const configured = positiveNumber(costs.codexSubscriptionMonthlyUsd) ?? positiveNumber(env.AGENT_RUNNER_CODEX_SUBSCRIPTION_USD);
  const monthlyUsd = configured ?? DEFAULT_CODEX_SUBSCRIPTION_USD;
  const seatMultiplier = positiveNumber(costs.codexSubscriptionSeatMultiplier) ?? positiveNumber(env.AGENT_RUNNER_CODEX_SUBSCRIPTION_SEATS) ?? 1;
  const weeklyBudgetUsd = (monthlyUsd * seatMultiplier) / WEEKS_PER_MONTH;
  return {
    monthlyUsd,
    seatMultiplier,
    weeklyBudgetUsd,
    priceMethod: configured === null ? "estimated" : "measured",
    allocationMethod: "allocated",
    formula: `${formatUsd(monthlyUsd)} monthly / ${WEEKS_PER_MONTH.toFixed(2)} = ${formatUsd(weeklyBudgetUsd)} weekly`
  };
}

function appServerEvents(payload) {
  const events = [];
  for (const candidate of [
    payload?.event,
    payload?.appServerEvent,
    payload?.app_server_event,
    ...(Array.isArray(payload?.events) ? payload.events : []),
    ...(Array.isArray(payload?.telemetry?.events) ? payload.telemetry.events : []),
    ...(Array.isArray(payload?.appServerEvents) ? payload.appServerEvents : []),
    ...(Array.isArray(payload?.app_server_events) ? payload.app_server_events : [])
  ]) {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      events.push(candidate);
    }
  }
  return events;
}

function codexJsonlTokenCountEvents(payload) {
  const result = [];
  const lines = Array.isArray(payload?.codexJsonl?.lines) ? payload.codexJsonl.lines : [];
  for (const line of lines) {
    if (typeof line !== "string" || !line.includes("token_count")) {
      continue;
    }
    const event = parseJson(line, null);
    if (event?.type !== "event_msg" || event?.payload?.type !== "token_count") {
      continue;
    }
    const tokenUsage = event.payload?.info?.total_token_usage || event.payload?.info?.last_token_usage || {};
    result.push({
      timestamp: event.timestamp || null,
      tokenUsage,
      rateLimits: event.payload?.rate_limits || null
    });
  }
  return result;
}

function largestTokenUsage(candidates) {
  let largest = normalizeTokenUsage({});
  for (const candidate of candidates) {
    const usage = normalizeTokenUsage(candidate || {});
    if (usage.totalTokens > largest.totalTokens) {
      largest = usage;
    }
  }
  return largest;
}

function eventType(event) {
  return String(event?.type || event?.event || event?.name || "").trim();
}

function windowsFromRateLimits(value, limits) {
  const result = { weekly: null, rolling5h: null, source: null };
  for (const [name, candidate] of Object.entries({
    primary: objectAt(value, "primary") || objectAt(limits, "primary"),
    secondary: objectAt(value, "secondary") || objectAt(limits, "secondary"),
    weekly: objectAt(value, "weekly") || objectAt(limits, "weekly"),
    rolling5h: objectAt(value, "rolling5h") || objectAt(value, "rolling_5h") || objectAt(limits, "rolling5h") || objectAt(limits, "rolling_5h")
  })) {
    if (!candidate) {
      continue;
    }
    const durationMinutes = durationMinutesFor(candidate);
    const kind = windowKindFor(name, candidate, durationMinutes);
    if (kind === "weekly") {
      result.weekly = { ...candidate, durationMinutes, method: "measured" };
      result.source = result.source || "app-server-rate-limits";
    } else if (kind === "rolling5h") {
      result.rolling5h = { ...candidate, durationMinutes, method: "measured" };
      result.source = result.source || "app-server-rate-limits";
    }
  }
  return result;
}

function windowKindFor(name, candidate, durationMinutes) {
  const label = String(candidate.window || candidate.name || candidate.label || name || "").toLowerCase();
  if (durationMinutes !== null && Math.abs(durationMinutes - 10080) <= 120) {
    return "weekly";
  }
  if (durationMinutes !== null && Math.abs(durationMinutes - 300) <= 60) {
    return "rolling5h";
  }
  if (/week|secondary/u.test(label)) {
    return "weekly";
  }
  if (/5h|5\s*hour|rolling|primary/u.test(label)) {
    return "rolling5h";
  }
  return null;
}

function normalizeRemaining(value, options = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const durationMinutes = durationMinutesFor(value);
  let limitTokens = nullableNumber(value.limitTokens ?? value.limit_tokens ?? value.limit ?? value.total ?? value.quota);
  let remainingTokens = nullableNumber(value.remainingTokens ?? value.remaining_tokens ?? value.remaining ?? value.left);
  let usedTokens = nullableNumber(value.usedTokens ?? value.used_tokens ?? value.used ?? value.consumed);
  let usedPercent = nullableNumber(value.usedPercent ?? value.used_percent ?? value.percentUsed ?? value.percent_used);
  let percentRemaining = nullableNumber(value.percentRemaining ?? value.percent_remaining ?? value.remainingPercent ?? value.remaining_percent);

  if (remainingTokens === null && limitTokens !== null && usedTokens !== null) {
    remainingTokens = Math.max(0, limitTokens - usedTokens);
  }
  if (usedTokens === null && limitTokens !== null && remainingTokens !== null) {
    usedTokens = Math.max(0, limitTokens - remainingTokens);
  }
  if (limitTokens === null && usedTokens !== null && usedPercent && usedPercent > 0) {
    limitTokens = usedTokens / (usedPercent / 100);
  }
  if (limitTokens === null && remainingTokens !== null && percentRemaining && percentRemaining > 0) {
    limitTokens = remainingTokens / (percentRemaining / 100);
  }
  if (percentRemaining === null && limitTokens && remainingTokens !== null) {
    percentRemaining = (remainingTokens / limitTokens) * 100;
  }
  if (usedPercent === null && percentRemaining !== null) {
    usedPercent = 100 - percentRemaining;
  }
  if (percentRemaining === null && usedPercent !== null) {
    percentRemaining = 100 - usedPercent;
  }

  const resetAt =
    timestampValue(value.resetAt) ||
    timestampValue(value.reset_at) ||
    timestampValue(value.resetsAt) ||
    timestampValue(value.resets_at) ||
    timestampValue(value.expiresAt) ||
    timestampValue(value.expires_at) ||
    null;
  const method = normalizeMethod(value.method) || (remainingTokens !== null || usedTokens !== null || percentRemaining !== null ? "measured" : "unknown");
  return {
    ...value,
    windowKind: options.windowKind || value.windowKind || value.window_kind || null,
    durationMinutes,
    remainingTokens,
    limitTokens,
    usedTokens,
    percentRemaining: clampPercent(percentRemaining),
    usedPercent: clampPercent(usedPercent),
    resetAt,
    method
  };
}

function normalizeReset(value, limits, weekly, rolling5h) {
  const reset = objectAt(value, "reset") || objectAt(value, "resets") || {};
  return {
    weeklyResetAt:
      stringValue(reset.weeklyResetAt) ||
      stringValue(reset.weekly_reset_at) ||
      stringValue(value.weeklyResetAt) ||
      stringValue(value.weekly_reset_at) ||
      stringValue(limits.weeklyResetAt) ||
      stringValue(limits.weekly_reset_at) ||
      weekly?.resetAt ||
      null,
    rolling5hResetAt:
      stringValue(reset.rolling5hResetAt) ||
      stringValue(reset.rolling_5h_reset_at) ||
      stringValue(value.rolling5hResetAt) ||
      stringValue(value.rolling_5h_reset_at) ||
      stringValue(limits.rolling5hResetAt) ||
      stringValue(limits.rolling_5h_reset_at) ||
      rolling5h?.resetAt ||
      null
  };
}

function mergeAccountUsageSnapshots(left, right) {
  if (!left) {
    return right;
  }
  return {
    collectedAt: right.collectedAt || left.collectedAt,
    weeklyRemaining: right.weeklyRemaining || left.weeklyRemaining,
    rolling5hRemaining: right.rolling5hRemaining || left.rolling5hRemaining,
    tokenUsage: addTokenUsage(left.tokenUsage, right.tokenUsage),
    reset: {
      ...(left.reset || {}),
      ...(right.reset || {})
    },
    metadata: {
      ...(left.metadata || {}),
      ...(right.metadata || {})
    }
  };
}

function mapAccountUsageRow(row) {
  if (!row) {
    return null;
  }
  if (row.weeklyRemaining || row.rolling5hRemaining || row.tokenUsage) {
    return {
      id: row.id || null,
      sourceId: row.sourceId || row.source_id || null,
      collectedAt: row.collectedAt || row.collected_at || null,
      weeklyRemaining: normalizeRemaining(row.weeklyRemaining || row.weekly_remaining || null, { windowKind: "weekly" }),
      rolling5hRemaining: normalizeRemaining(row.rolling5hRemaining || row.rolling_5h_remaining || null, { windowKind: "rolling5h" }),
      tokenUsage: normalizeTokenUsage(row.tokenUsage || row.token_usage || {}),
      reset: row.reset || {},
      metadata: row.metadata || {}
    };
  }
  return {
    id: row.id || null,
    sourceId: row.source_id || null,
    collectedAt: row.collected_at || null,
    weeklyRemaining: normalizeRemaining(parseJson(row.weekly_remaining_json, null), { windowKind: "weekly" }),
    rolling5hRemaining: normalizeRemaining(parseJson(row.rolling_5h_remaining_json, null), { windowKind: "rolling5h" }),
    tokenUsage: normalizeTokenUsage(parseJson(row.token_usage_json, {})),
    reset: parseJson(row.reset_json, {}),
    metadata: parseJson(row.metadata_json, {})
  };
}

function usageWindow(value, resetAt) {
  if (!value) {
    return null;
  }
  return {
    remainingTokens: value.remainingTokens,
    limitTokens: value.limitTokens,
    usedTokens: value.usedTokens,
    percentRemaining: value.percentRemaining,
    usedPercent: value.usedPercent,
    resetAt: value.resetAt || resetAt || null,
    durationMinutes: value.durationMinutes,
    method: value.method || "measured"
  };
}

function burnForWindow(snapshots, nowMs, windowMs) {
  const points = snapshots
    .map((snapshot) => ({
      at: Date.parse(snapshot.collectedAt || ""),
      tokens: nullableNumber(snapshot.tokenUsage?.totalTokens ?? snapshot.tokenUsage?.tokens)
    }))
    .filter((point) => Number.isFinite(point.at) && point.at <= nowMs && point.tokens !== null)
    .sort((left, right) => left.at - right.at);
  const relevant = points.filter((point) => point.at >= nowMs - windowMs);
  if (relevant.length < 2) {
    return { tokens: null, tokensPerHour: null, snapshotCount: relevant.length, method: "unknown" };
  }
  let tokens = 0;
  for (let index = 1; index < relevant.length; index += 1) {
    const delta = relevant[index].tokens - relevant[index - 1].tokens;
    if (delta > 0) {
      tokens += delta;
    }
  }
  const elapsedMs = relevant.at(-1).at - relevant[0].at;
  return {
    tokens,
    tokensPerHour: elapsedMs > 0 ? tokens / (elapsedMs / (60 * 60 * 1000)) : null,
    snapshotCount: relevant.length,
    method: "measured"
  };
}

function accountQuotaDelta(accountUsage) {
  const snapshots = Array.isArray(accountUsage?.snapshots) ? [...accountUsage.snapshots] : [];
  const ordered = snapshots
    .filter((snapshot) => snapshot?.weeklyRemaining?.remainingTokens != null && snapshot?.weeklyRemaining?.limitTokens != null)
    .sort((left, right) => Date.parse(left.collectedAt || "") - Date.parse(right.collectedAt || ""));
  if (ordered.length < 2) {
    return { tokens: null, limitTokens: null };
  }
  const before = ordered[0].weeklyRemaining;
  const after = ordered.at(-1).weeklyRemaining;
  const delta = before.remainingTokens - after.remainingTokens;
  if (!(delta > 0)) {
    return { tokens: null, limitTokens: after.limitTokens || before.limitTokens || null };
  }
  return { tokens: delta, limitTokens: after.limitTokens || before.limitTokens || null };
}

function durationMinutesFor(value) {
  const minutes =
    nullableNumber(value.durationMinutes ?? value.duration_minutes ?? value.windowMinutes ?? value.window_minutes) ??
    secondsToMinutes(value.durationSeconds ?? value.duration_seconds ?? value.windowSeconds ?? value.window_seconds) ??
    msToMinutes(value.durationMs ?? value.duration_ms ?? value.windowMs ?? value.window_ms);
  if (minutes !== null) {
    return minutes;
  }
  const duration = value.duration || value.windowDuration || value.window_duration;
  if (typeof duration === "string") {
    const match = duration.match(/([0-9]+(?:\.[0-9]+)?)\s*(minute|min|hour|hr|day|week|m|h|d|w)s?/iu);
    if (match) {
      const amount = Number(match[1]);
      const unit = match[2].toLowerCase();
      if (unit.startsWith("m")) return amount;
      if (unit.startsWith("h")) return amount * 60;
      if (unit.startsWith("d")) return amount * 24 * 60;
      if (unit.startsWith("w")) return amount * 7 * 24 * 60;
    }
  }
  return null;
}

function secondsToMinutes(value) {
  const seconds = nullableNumber(value);
  return seconds === null ? null : seconds / 60;
}

function msToMinutes(value) {
  const ms = nullableNumber(value);
  return ms === null ? null : ms / 60000;
}

function elapsedMinutesBetween(startedAt, finishedAt, now) {
  const start = typeof startedAt === "string" ? Date.parse(startedAt) : NaN;
  if (!Number.isFinite(start)) {
    return null;
  }
  const finish = typeof finishedAt === "string" ? Date.parse(finishedAt) : Number.isFinite(now) ? now : Date.now();
  return Number.isFinite(finish) ? Math.max(0, (finish - start) / 60000) : null;
}

function objectAt(value, key) {
  const item = value?.[key];
  return item && typeof item === "object" && !Array.isArray(item) ? item : null;
}

function parseJson(value, fallback) {
  if (value && typeof value === "object") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function normalizeMethod(value) {
  return methodValues.has(value) ? value : null;
}

function clampPercent(value) {
  return value === null ? null : Math.max(0, Math.min(100, value));
}

function positiveNumber(value) {
  const numeric = nullableNumber(value);
  return numeric !== null && numeric > 0 ? numeric : null;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function finiteNumber(value) {
  return nullableNumber(value) ?? 0;
}

function stringValue(value) {
  return typeof value === "string" && value ? value : null;
}

function timestampValue(value) {
  if (typeof value === "string" && value.trim()) {
    return value;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  const milliseconds = numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  return new Date(milliseconds).toISOString();
}

function formatUsd(value) {
  return `$${value.toFixed(2)}`;
}
