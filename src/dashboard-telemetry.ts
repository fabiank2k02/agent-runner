export type LiveEventType =
  | "agent_message"
  | "command_started"
  | "command_finished"
  | "file_read"
  | "file_edited"
  | "file_created"
  | "file_deleted"
  | "patch_applied"
  | "tool_call"
  | "error"
  | "status_changed";

export type Confidence = "low" | "medium" | "high";
export type Severity = "info" | "success" | "warning" | "error";
export type GoalState = "not_started" | "active" | "complete" | "blocked" | "unknown";

export interface LiveEvent {
  id: string;
  timestamp: string | null;
  type: LiveEventType;
  label: string;
  detail?: string;
  severity: Severity;
  status?: string;
  filePath?: string;
  command?: {
    text?: string;
    exitCode?: number | null;
  };
  tool?: {
    name?: string;
  };
  inferred?: boolean;
  confidence: Confidence;
  source: string;
}

export interface FileActivity {
  path: string;
  latestAction: "read" | "edited" | "created" | "deleted" | "patched";
  readCount: number;
  editCount: number;
  createCount: number;
  deleteCount: number;
  patchCount: number;
  lastSeenAt: string | null;
  confidence: Confidence;
  source: string;
}

export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
}

export interface SpendInputs {
  usage: TokenUsage;
  startedAt?: string | null;
  finishedAt?: string | null;
  now?: number;
  costs?: {
    digitalOceanHourlyUsd?: number;
    codexSubscriptionMonthlyUsd?: number;
    codexSubscriptionSeatMultiplier?: number;
    codexSubscriptionMonthlyTokens?: number;
    codexWeeklyTokenAllowance?: number;
    codexObservedWeeklyTokens?: number;
  };
}

export interface SpendEstimate extends TokenUsage {
  elapsedMinutes: number | null;
  digitalOceanHourlyUsd: number | null;
  digitalOceanCostUsd: number | null;
  digitalOceanMethod: "allocated" | "unknown";
  codexSubscriptionMonthlyUsd: number | null;
  codexSubscriptionSeatMultiplier: number;
  codexSubscriptionPriceMethod: "measured" | "estimated";
  codexWeeklyBudgetUsd: number | null;
  codexWeeklyBudgetFormula: string | null;
  codexSubscriptionMonthlyTokens: number | null;
  codexWeeklyTokenAllowance: number | null;
  codexObservedWeeklyTokens: number | null;
  codexTaskAllocationUsd: number | null;
  codexTokenCostUsd: number | null;
  codexTaskAllocationPercent: number | null;
  codexRemainingWeeklyBudgetUsd: number | null;
  codexAllocationMethod: "measured" | "estimated" | "unknown";
  codexAllocationSource: string;
  codexCostMethod: "measured" | "estimated" | "unknown";
  codexCostSource: string;
  totalOperationalCostUsd: number | null;
  totalEstimatedCostUsd: number | null;
}

export interface GoalSummary {
  id: string;
  label: string;
  state: GoalState;
  confidence: Confidence;
  source: string;
}

export interface SubgoalSummary extends GoalSummary {
  parentId?: string;
}

const MAX_LABEL_CHARS = 120;
const MAX_DETAIL_CHARS = 500;
const DEFAULT_EVENT_LIMIT = 200;
const WEEKS_PER_MONTH = 52 / 12;
const WEEK_MINUTES = 7 * 24 * 60;

export function extractLiveEvents(logText: string, options: { limit?: number } = {}): LiveEvent[] {
  const limit = Math.max(1, Math.min(500, options.limit ?? DEFAULT_EVENT_LIMIT));
  const events: LiveEvent[] = [];
  const lines = String(logText || "").split(/\r?\n/u);

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      events.push(...eventsFromPlainLine(line, index));
      continue;
    }

    events.push(...eventsFromJson(parsed, line, index));
  }

  return dedupeEvents(events).slice(-limit);
}

export function aggregateFileActivity(events: LiveEvent[], limit = 120): FileActivity[] {
  const files = new Map<string, FileActivity>();
  for (const event of events) {
    if (!event.filePath) {
      continue;
    }
    const action = fileActionForEvent(event.type);
    if (!action) {
      continue;
    }
    const existing = files.get(event.filePath) ?? {
      path: event.filePath,
      latestAction: action,
      readCount: 0,
      editCount: 0,
      createCount: 0,
      deleteCount: 0,
      patchCount: 0,
      lastSeenAt: null,
      confidence: event.confidence,
      source: event.source
    };

    existing.latestAction = action;
    existing.lastSeenAt = event.timestamp || existing.lastSeenAt;
    existing.confidence = confidenceMax(existing.confidence, event.confidence);
    existing.source = mergeSource(existing.source, event.source);
    if (action === "read") {
      existing.readCount += 1;
    } else if (action === "edited") {
      existing.editCount += 1;
    } else if (action === "created") {
      existing.createCount += 1;
    } else if (action === "deleted") {
      existing.deleteCount += 1;
    } else if (action === "patched") {
      existing.patchCount += 1;
    }
    files.set(event.filePath, existing);
  }

  return Array.from(files.values())
    .sort((left, right) => compareNullableDates(right.lastSeenAt, left.lastSeenAt) || left.path.localeCompare(right.path))
    .slice(0, limit);
}

export function extractTokenUsage(logText: string): TokenUsage {
  const usage: TokenUsage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0
  };

  for (const line of String(logText || "").split(/\r?\n/u)) {
    if (!line.trim()) {
      continue;
    }
    let event: any;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const type = typeof event?.type === "string" ? event.type : "";
    if (type && !["turn.completed", "response.completed"].includes(type)) {
      continue;
    }
    const item = event?.usage ?? event?.response?.usage;
    if (!item || typeof item !== "object") {
      continue;
    }
    usage.inputTokens += finiteNumber(item.input_tokens ?? item.inputTokens);
    usage.cachedInputTokens += finiteNumber(item.cached_input_tokens ?? item.cachedInputTokens);
    usage.outputTokens += finiteNumber(item.output_tokens ?? item.outputTokens);
    usage.reasoningOutputTokens += finiteNumber(item.reasoning_output_tokens ?? item.reasoningOutputTokens);
  }

  usage.totalTokens = usage.inputTokens + usage.outputTokens;
  return usage;
}

export function calculateSubscriptionSpend(input: SpendInputs): SpendEstimate {
  const usage = normalizeUsage(input.usage);
  const startedAt = typeof input.startedAt === "string" ? Date.parse(input.startedAt) : NaN;
  const finishedAt = typeof input.finishedAt === "string" ? Date.parse(input.finishedAt) : NaN;
  const end = Number.isFinite(finishedAt) ? finishedAt : input.now ?? Date.now();
  const elapsedMinutes = Number.isFinite(startedAt) ? Math.max(0, (end - startedAt) / 60000) : null;
  const costs = input.costs ?? {};

  const digitalOceanHourlyUsd = nullablePositive(costs.digitalOceanHourlyUsd);
  const digitalOceanCostUsd =
    elapsedMinutes === null || digitalOceanHourlyUsd === null ? null : digitalOceanHourlyUsd * (elapsedMinutes / 60);
  const digitalOceanMethod = digitalOceanCostUsd === null ? "unknown" : "allocated";

  const configuredCodexMonthlyUsd = nullablePositive(costs.codexSubscriptionMonthlyUsd);
  const codexSubscriptionMonthlyUsd = configuredCodexMonthlyUsd ?? 100;
  const codexSubscriptionSeatMultiplier = nullablePositive(costs.codexSubscriptionSeatMultiplier) ?? 1;
  const codexWeeklyBudgetUsd =
    codexSubscriptionMonthlyUsd === null
      ? null
      : (codexSubscriptionMonthlyUsd * codexSubscriptionSeatMultiplier) / WEEKS_PER_MONTH;
  const codexSubscriptionPriceMethod = configuredCodexMonthlyUsd === null ? "estimated" : "measured";
  const codexWeeklyBudgetFormula =
    codexWeeklyBudgetUsd === null
      ? null
      : `${formatUsd(codexSubscriptionMonthlyUsd)} monthly / ${WEEKS_PER_MONTH.toFixed(2)} = ${formatUsd(codexWeeklyBudgetUsd)} weekly`;

  const codexSubscriptionMonthlyTokens = nullablePositive(costs.codexSubscriptionMonthlyTokens);
  const configuredWeeklyTokens = nullablePositive(costs.codexWeeklyTokenAllowance);
  const observedWeeklyTokens = nullablePositive(costs.codexObservedWeeklyTokens);
  const estimatedWeeklyTokens = codexSubscriptionMonthlyTokens === null ? null : codexSubscriptionMonthlyTokens / WEEKS_PER_MONTH;
  const codexWeeklyTokenAllowance = configuredWeeklyTokens ?? observedWeeklyTokens ?? estimatedWeeklyTokens;
  const tokenAllowanceSource = configuredWeeklyTokens || observedWeeklyTokens ? "measured" : estimatedWeeklyTokens ? "estimated" : "unknown";

  let codexTaskAllocationUsd: number | null = null;
  let codexAllocationMethod: "measured" | "estimated" | "unknown" = "unknown";
  let codexAllocationSource = "missing_budget";
  if (codexWeeklyBudgetUsd !== null) {
    if (usage.totalTokens > 0 && codexWeeklyTokenAllowance !== null) {
      codexTaskAllocationUsd = codexWeeklyBudgetUsd * (usage.totalTokens / codexWeeklyTokenAllowance);
      codexAllocationMethod = tokenAllowanceSource;
      codexAllocationSource = `${tokenAllowanceSource}_tokens`;
    } else if (elapsedMinutes !== null) {
      codexTaskAllocationUsd = codexWeeklyBudgetUsd * (elapsedMinutes / WEEK_MINUTES);
      codexAllocationMethod = "estimated";
      codexAllocationSource = "runtime_allocation";
    } else {
      codexAllocationMethod = "unknown";
      codexAllocationSource = "missing_tokens";
    }
  }
  const codexTaskAllocationPercent =
    codexTaskAllocationUsd === null || codexWeeklyBudgetUsd === null || codexWeeklyBudgetUsd === 0
      ? null
      : (codexTaskAllocationUsd / codexWeeklyBudgetUsd) * 100;
  const codexRemainingWeeklyBudgetUsd =
    codexTaskAllocationUsd === null || codexWeeklyBudgetUsd === null
      ? codexWeeklyBudgetUsd
      : Math.max(0, codexWeeklyBudgetUsd - codexTaskAllocationUsd);
  const knownParts = [digitalOceanCostUsd, codexTaskAllocationUsd].filter((value): value is number => typeof value === "number");
  const totalOperationalCostUsd = knownParts.length ? knownParts.reduce((sum, value) => sum + value, 0) : null;

  return {
    ...usage,
    elapsedMinutes,
    digitalOceanHourlyUsd,
    digitalOceanCostUsd,
    digitalOceanMethod,
    codexSubscriptionMonthlyUsd,
    codexSubscriptionSeatMultiplier,
    codexSubscriptionPriceMethod,
    codexWeeklyBudgetUsd,
    codexWeeklyBudgetFormula,
    codexSubscriptionMonthlyTokens,
    codexWeeklyTokenAllowance,
    codexObservedWeeklyTokens: observedWeeklyTokens,
    codexTaskAllocationUsd,
    codexTokenCostUsd: codexTaskAllocationUsd,
    codexTaskAllocationPercent,
    codexRemainingWeeklyBudgetUsd,
    codexAllocationMethod,
    codexAllocationSource,
    codexCostMethod: codexAllocationMethod,
    codexCostSource: codexAllocationSource,
    totalOperationalCostUsd,
    totalEstimatedCostUsd: totalOperationalCostUsd
  };
}

export function deriveGoalsFromPrompt(prompt: string, limit = 12): GoalSummary[] {
  const lines = String(prompt || "").split(/\r?\n/u);
  const goals: GoalSummary[] = [];
  let inRequiredSection = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (/^##\s+required improvements\b/iu.test(line)) {
      inRequiredSection = true;
      continue;
    }
    if (inRequiredSection && /^##\s+/u.test(line)) {
      break;
    }
    const numbered = line.match(/^\d+\.\s+(.+)$/u);
    if (inRequiredSection && numbered) {
      goals.push(goalFromLabel(numbered[1], "prompt"));
    }
  }

  if (!goals.length) {
    for (const rawLine of lines) {
      const line = rawLine.trim();
      const heading = line.match(/^#{2,3}\s+(.+)$/u);
      if (heading && !/^(objective|validation|non-goals|follow-up ideas)$/iu.test(heading[1])) {
        goals.push(goalFromLabel(heading[1], "prompt"));
      }
      if (goals.length >= limit) {
        break;
      }
    }
  }

  if (!goals.length) {
    for (const rawLine of lines) {
      const bullet = rawLine.trim().match(/^[-*]\s+(.+)$/u);
      if (bullet && bullet[1].length > 8) {
        goals.push(goalFromLabel(bullet[1], "prompt"));
      }
      if (goals.length >= limit) {
        break;
      }
    }
  }

  return dedupeGoals(goals).slice(0, limit);
}

export function deriveSubgoalsFromEvents(events: LiveEvent[], limit = 12): SubgoalSummary[] {
  const subgoals: SubgoalSummary[] = [];
  for (const event of events.slice(-80)) {
    if (event.type === "command_started" && event.command?.text) {
      subgoals.push({
        id: stableId("subgoal", event.command.text),
        label: `Run ${clipText(event.command.text, 90)}`,
        state: "active",
        confidence: "medium",
        source: "events"
      });
    } else if (event.type === "file_edited" || event.type === "file_created" || event.type === "file_deleted") {
      subgoals.push({
        id: stableId("subgoal", `${event.type}:${event.filePath}`),
        label: `${formatEventAction(event.type)} ${event.filePath}`,
        state: event.type === "file_deleted" ? "active" : "active",
        confidence: event.confidence,
        source: "events"
      });
    } else if (event.type === "error") {
      subgoals.push({
        id: stableId("subgoal", `error:${event.label}:${event.detail || ""}`),
        label: event.label,
        state: "blocked",
        confidence: event.confidence,
        source: "events"
      });
    }
  }
  return dedupeGoals(subgoals).slice(-limit);
}

export function currentActivityFromEvents(events: LiveEvent[], fallback = "Waiting for structured activity."): string {
  const event = events
    .slice()
    .reverse()
    .find((item) => !["file_read"].includes(item.type));
  if (!event) {
    return fallback;
  }
  if (event.type === "command_started" && event.command?.text) {
    return `Running command: ${clipText(event.command.text, 160)}`;
  }
  if (event.type === "command_finished" && event.command?.text) {
    return `Finished command: ${clipText(event.command.text, 160)}`;
  }
  if (event.type === "agent_message" && event.detail) {
    return clipText(event.detail, 180);
  }
  if (event.filePath) {
    return `${event.label}: ${event.filePath}`;
  }
  return event.detail ? `${event.label}: ${clipText(event.detail, 160)}` : event.label;
}

export function telemetryRuntimeSource(): string {
  return [
    "const MAX_LABEL_CHARS = 120;",
    "const MAX_DETAIL_CHARS = 500;",
    "const DEFAULT_EVENT_LIMIT = 200;",
    "const WEEKS_PER_MONTH = 52 / 12;",
    "const WEEK_MINUTES = 7 * 24 * 60;",
    fnv1aHash.toString(),
    stableId.toString(),
    clipText.toString(),
    truncateMiddle.toString(),
    finiteNumber.toString(),
    nullablePositive.toString(),
    normalizeUsage.toString(),
    extractLiveEvents.toString(),
    aggregateFileActivity.toString(),
    extractTokenUsage.toString(),
    formatUsd.toString(),
    calculateSubscriptionSpend.toString(),
    deriveGoalsFromPrompt.toString(),
    deriveSubgoalsFromEvents.toString(),
    currentActivityFromEvents.toString(),
    eventsFromPlainLine.toString(),
    eventsFromJson.toString(),
    classifyItemEvent.toString(),
    eventsFromCommand.toString(),
    eventsFromPatchText.toString(),
    extractCommandText.toString(),
    extractToolName.toString(),
    extractExitCode.toString(),
    extractText.toString(),
    extractPatchText.toString(),
    collectStrings.toString(),
    extractCandidatePaths.toString(),
    cleanPathToken.toString(),
    normalizeTimestamp.toString(),
    normalizeEventType.toString(),
    createEvent.toString(),
    dedupeEvents.toString(),
    fileActionForEvent.toString(),
    confidenceMax.toString(),
    confidenceRank.toString(),
    mergeSource.toString(),
    compareNullableDates.toString(),
    goalFromLabel.toString(),
    dedupeGoals.toString(),
    formatEventAction.toString()
  ].join("\n\n");
}

function eventsFromPlainLine(line: string, lineNumber: number): LiveEvent[] {
  const lower = line.toLowerCase();
  const source = `plain:${fnv1aHash(line)}`;
  if (line.includes("*** Begin Patch") || line.includes("*** Update File:") || line.includes("*** Add File:") || line.includes("*** Delete File:")) {
    return eventsFromPatchText(line, null, source);
  }
  if (lower.includes("error") || lower.includes("failed") || lower.includes("exception")) {
    return [
      createEvent({
        timestamp: null,
        type: "error",
        label: "Log error",
        detail: clipText(line, MAX_DETAIL_CHARS),
        severity: "error",
        inferred: true,
        confidence: "low",
        source: `plain:${lineNumber}:${fnv1aHash(line)}`
      })
    ];
  }
  return [];
}

function eventsFromJson(value: unknown, rawLine: string, lineNumber: number): LiveEvent[] {
  const event: any = value && typeof value === "object" ? value : {};
  const type = typeof event.type === "string" ? event.type : "";
  const timestamp = normalizeTimestamp(event.timestamp ?? event.time ?? event.created_at ?? event.createdAt ?? event.item?.timestamp);
  const source = `json:${type || "unknown"}:${fnv1aHash(rawLine)}`;
  const events: LiveEvent[] = [];

  if (event.error || /error|failed|exception/iu.test(type)) {
    events.push(
      createEvent({
        timestamp,
        type: "error",
        label: "Codex error",
        detail: clipText(extractText(event.error ?? event.message ?? event.detail ?? event), MAX_DETAIL_CHARS),
        severity: "error",
        confidence: "medium",
        source
      })
    );
  }

  const item = event.item && typeof event.item === "object" ? event.item : event;
  events.push(...classifyItemEvent(type, item, timestamp, source));

  if (type === "turn.completed" || type === "response.completed") {
    const usage = event.usage ?? event.response?.usage;
    const total = finiteNumber(usage?.input_tokens ?? usage?.inputTokens) + finiteNumber(usage?.output_tokens ?? usage?.outputTokens);
    if (total > 0) {
      events.push(
        createEvent({
          timestamp,
          type: "status_changed",
          label: "Turn completed",
          detail: `${total.toLocaleString()} tokens observed`,
          severity: "success",
          confidence: "high",
          source
        })
      );
    }
  }

  if (!events.length && type) {
    events.push(
      createEvent({
        timestamp,
        type: "tool_call",
        label: normalizeEventType(type),
        detail: clipText(extractText(event.message ?? event.detail ?? event.item ?? ""), MAX_DETAIL_CHARS),
        severity: "info",
        confidence: "low",
        source: `${source}:${lineNumber}`,
        inferred: true
      })
    );
  }

  return events;
}

function classifyItemEvent(type: string, item: any, timestamp: string | null, source: string): LiveEvent[] {
  const events: LiveEvent[] = [];
  const itemType = typeof item?.type === "string" ? item.type : "";
  const command = extractCommandText(item);
  const toolName = extractToolName(item);
  const patchText = extractPatchText(item);
  const isStarted = /started|start|begin/iu.test(type);
  const isCompleted = /completed|finish|finished|done/iu.test(type);

  if (itemType === "agent_message" || item?.role === "assistant") {
    const text = extractText(item.text ?? item.message ?? item.content ?? "");
    if (text) {
      events.push(
        createEvent({
          timestamp,
          type: "agent_message",
          label: "Agent message",
          detail: clipText(text, MAX_DETAIL_CHARS),
          severity: "info",
          confidence: "high",
          source
        })
      );
    }
  }

  if (command) {
    const exitCode = extractExitCode(item);
    const failed = exitCode !== null && exitCode !== 0;
    events.push(
      createEvent({
        timestamp,
        type: isStarted && !isCompleted ? "command_started" : "command_finished",
        label: isStarted && !isCompleted ? "Command started" : failed ? "Command failed" : "Command finished",
        detail: clipText(command, MAX_DETAIL_CHARS),
        severity: failed ? "error" : isStarted && !isCompleted ? "info" : "success",
        status: isStarted && !isCompleted ? "started" : failed ? "failed" : "finished",
        command: { text: command, exitCode },
        confidence: "high",
        source
      })
    );
    events.push(...eventsFromCommand(command, timestamp, source));
  }

  if (toolName && !command) {
    events.push(
      createEvent({
        timestamp,
        type: "tool_call",
        label: `Tool ${toolName}`,
        detail: clipText(extractText(item.arguments ?? item.input ?? item), MAX_DETAIL_CHARS),
        severity: "info",
        status: isCompleted ? "finished" : isStarted ? "started" : undefined,
        tool: { name: toolName },
        confidence: "medium",
        source
      })
    );
  }

  if (patchText) {
    events.push(...eventsFromPatchText(patchText, timestamp, source));
  }

  return events;
}

function eventsFromCommand(command: string, timestamp: string | null, source: string): LiveEvent[] {
  const lower = command.toLowerCase();
  const paths = extractCandidatePaths(command).slice(0, 12);
  if (!paths.length) {
    return [];
  }

  let type: LiveEventType | null = null;
  let label = "";
  let severity: Severity = "info";
  let confidence: Confidence = "medium";
  if (/\b(rm|unlink)\b/u.test(lower)) {
    type = "file_deleted";
    label = "File deleted";
    severity = "warning";
  } else if (/\b(apply_patch)\b/u.test(lower)) {
    type = "patch_applied";
    label = "Patch applied";
    confidence = "low";
  } else if (/(^|\s)(cat|printf|echo)\b[\s\S]*(>|\btee\b)|\b(touch|mv|cp)\b/u.test(lower)) {
    type = "file_edited";
    label = "File edited";
    confidence = "low";
  } else if (/\b(sed|cat|rg|grep|ls|find|nl|wc|head|tail|git\s+(show|diff|status))\b/u.test(lower)) {
    type = "file_read";
    label = "File inspected";
  }
  if (!type) {
    return [];
  }

  return paths.map((filePath) =>
    createEvent({
      timestamp,
      type,
      label,
      detail: clipText(command, MAX_DETAIL_CHARS),
      severity,
      filePath,
      command: { text: command },
      inferred: true,
      confidence,
      source
    })
  );
}

function eventsFromPatchText(patchText: string, timestamp: string | null, source: string): LiveEvent[] {
  const files: Array<{ action: LiveEventType; path: string }> = [];
  for (const rawLine of String(patchText || "").split(/\r?\n/u)) {
    const line = rawLine.trim();
    const patchMatch = line.match(/^\*\*\*\s+(Update|Add|Delete)\s+File:\s+(.+)$/u);
    if (patchMatch) {
      const action = patchMatch[1] === "Add" ? "file_created" : patchMatch[1] === "Delete" ? "file_deleted" : "file_edited";
      files.push({ action, path: patchMatch[2].trim() });
      continue;
    }
    const diffMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/u);
    if (diffMatch) {
      files.push({ action: "file_edited", path: diffMatch[2].trim() });
    }
  }

  const uniqueFiles = Array.from(new Map(files.map((file) => [`${file.action}:${file.path}`, file])).values()).slice(0, 20);
  if (!uniqueFiles.length) {
    return [
      createEvent({
        timestamp,
        type: "patch_applied",
        label: "Patch applied",
        detail: clipText(patchText, MAX_DETAIL_CHARS),
        severity: "success",
        confidence: "medium",
        source
      })
    ];
  }

  const events: LiveEvent[] = [
    createEvent({
      timestamp,
      type: "patch_applied",
      label: "Patch applied",
      detail: uniqueFiles.map((file) => file.path).join(", "),
      severity: "success",
      confidence: "high",
      source
    })
  ];

  for (const file of uniqueFiles) {
    events.push(
      createEvent({
        timestamp,
        type: file.action,
        label: formatEventAction(file.action),
        detail: "From applied patch",
        severity: file.action === "file_deleted" ? "warning" : "success",
        filePath: file.path,
        confidence: "high",
        source
      })
    );
  }
  return events;
}

function extractCommandText(item: any): string {
  const candidates = [
    item?.command,
    item?.cmd,
    item?.input?.command,
    item?.input?.cmd,
    item?.arguments?.command,
    item?.arguments?.cmd,
    item?.raw_item?.command
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return "";
}

function extractToolName(item: any): string {
  const candidates = [
    item?.tool,
    item?.toolName,
    item?.tool_name,
    item?.name,
    item?.function?.name,
    item?.raw_item?.name,
    item?.call?.name
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  const type = typeof item?.type === "string" ? item.type : "";
  return /tool|function|mcp/iu.test(type) ? type : "";
}

function extractExitCode(item: any): number | null {
  const value = item?.exit_code ?? item?.exitCode ?? item?.status_code ?? item?.result?.exitCode ?? item?.output?.exitCode;
  const numeric = Number(value);
  return Number.isInteger(numeric) ? numeric : null;
}

function extractText(value: any): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => extractText(item)).filter(Boolean).join("\n");
  }
  if (value && typeof value === "object") {
    if (typeof value.text === "string") {
      return value.text;
    }
    if (typeof value.content === "string") {
      return value.content;
    }
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return value == null ? "" : String(value);
}

function extractPatchText(item: any): string {
  for (const text of collectStrings(item, 20)) {
    if (text.includes("*** Begin Patch") || text.includes("*** Update File:") || text.includes("*** Add File:") || text.includes("*** Delete File:")) {
      return text;
    }
  }
  return "";
}

function collectStrings(value: any, limit: number): string[] {
  const output: string[] = [];
  const visit = (item: any): void => {
    if (output.length >= limit || item == null) {
      return;
    }
    if (typeof item === "string") {
      output.push(item);
      return;
    }
    if (Array.isArray(item)) {
      for (const child of item) {
        visit(child);
      }
      return;
    }
    if (typeof item === "object") {
      for (const child of Object.values(item)) {
        visit(child);
      }
    }
  };
  visit(value);
  return output;
}

function extractCandidatePaths(text: string): string[] {
  const tokens = String(text || "").match(/(?:\.{0,2}\/|~\/|[A-Za-z0-9_.-]+\/)[A-Za-z0-9_@%+=:,./ -]+|[A-Za-z0-9_.-]+\.[A-Za-z0-9_.-]+/gu) ?? [];
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const token of tokens) {
    const cleaned = cleanPathToken(token);
    if (
      !cleaned ||
      cleaned.startsWith("http") ||
      cleaned.includes("://") ||
      cleaned === "." ||
      cleaned === ".." ||
      seen.has(cleaned)
    ) {
      continue;
    }
    if (!/[/.]/u.test(cleaned)) {
      continue;
    }
    seen.add(cleaned);
    paths.push(cleaned);
  }
  return paths;
}

function cleanPathToken(value: string): string {
  return String(value || "")
    .trim()
    .replace(/^["'`]+|["'`,;:)]+$/gu, "")
    .replace(/:\d+(:\d+)?$/u, "");
}

function normalizeTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function normalizeEventType(value: string): string {
  return value
    .replace(/[._-]+/gu, " ")
    .replace(/\b\w/gu, (match) => match.toUpperCase())
    .slice(0, MAX_LABEL_CHARS);
}

function createEvent(input: Omit<LiveEvent, "id">): LiveEvent {
  const event = {
    ...input,
    label: clipText(input.label, MAX_LABEL_CHARS),
    detail: input.detail ? clipText(input.detail, MAX_DETAIL_CHARS) : undefined
  };
  return {
    ...event,
    id: stableId(event.type, event.timestamp ?? "", event.label, event.detail ?? "", event.filePath ?? "", event.source)
  };
}

function dedupeEvents(events: LiveEvent[]): LiveEvent[] {
  const seen = new Set<string>();
  const output: LiveEvent[] = [];
  for (const event of events) {
    if (seen.has(event.id)) {
      continue;
    }
    seen.add(event.id);
    output.push(event);
  }
  return output;
}

function fileActionForEvent(type: LiveEventType): FileActivity["latestAction"] | null {
  if (type === "file_read") {
    return "read";
  }
  if (type === "file_edited") {
    return "edited";
  }
  if (type === "file_created") {
    return "created";
  }
  if (type === "file_deleted") {
    return "deleted";
  }
  if (type === "patch_applied") {
    return "patched";
  }
  return null;
}

function confidenceMax(left: Confidence, right: Confidence): Confidence {
  return confidenceRank(left) >= confidenceRank(right) ? left : right;
}

function confidenceRank(value: Confidence): number {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
}

function mergeSource(left: string, right: string): string {
  if (left === right) {
    return left;
  }
  if (left.includes(right)) {
    return left;
  }
  return `${left},${right}`.slice(0, 80);
}

function compareNullableDates(left: string | null, right: string | null): number {
  const leftTime = left ? Date.parse(left) : 0;
  const rightTime = right ? Date.parse(right) : 0;
  return (Number.isFinite(leftTime) ? leftTime : 0) - (Number.isFinite(rightTime) ? rightTime : 0);
}

function goalFromLabel(label: string, source: string): GoalSummary {
  const clean = clipText(label.replace(/[`*_#]/gu, "").trim(), 140);
  return {
    id: stableId("goal", clean),
    label: clean,
    state: "unknown",
    confidence: "medium",
    source
  };
}

function dedupeGoals<T extends GoalSummary>(goals: T[]): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const goal of goals) {
    const key = goal.id || stableId("goal", goal.label);
    if (seen.has(key) || !goal.label) {
      continue;
    }
    seen.add(key);
    output.push({ ...goal, id: key });
  }
  return output;
}

function formatEventAction(type: LiveEventType): string {
  if (type === "file_read") {
    return "File inspected";
  }
  if (type === "file_created") {
    return "File created";
  }
  if (type === "file_deleted") {
    return "File deleted";
  }
  if (type === "patch_applied") {
    return "Patch applied";
  }
  return "File edited";
}

function normalizeUsage(usage: Partial<TokenUsage> | undefined): TokenUsage {
  return {
    inputTokens: finiteNumber(usage?.inputTokens),
    cachedInputTokens: finiteNumber(usage?.cachedInputTokens),
    outputTokens: finiteNumber(usage?.outputTokens),
    reasoningOutputTokens: finiteNumber(usage?.reasoningOutputTokens),
    totalTokens:
      finiteNumber(usage?.totalTokens) ||
      finiteNumber(usage?.inputTokens) + finiteNumber(usage?.outputTokens)
  };
}

function nullablePositive(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function finiteNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function stableId(...parts: string[]): string {
  return fnv1aHash(parts.join("|"));
}

function fnv1aHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function clipText(value: string, maxChars: number): string {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}...`;
}

function truncateMiddle(value: string, maxChars: number): string {
  const text = String(value || "");
  if (text.length <= maxChars) {
    return text;
  }
  const keep = Math.floor((maxChars - 16) / 2);
  return `${text.slice(0, keep)}...[truncated]...${text.slice(-keep)}`;
}
