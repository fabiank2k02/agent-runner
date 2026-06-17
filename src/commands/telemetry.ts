import type { CommandContext } from "../context.js";
import {
  flushLocalTelemetry,
  localTelemetryStatus,
  runLocalTelemetryService,
  startLocalTelemetryService,
  stopLocalTelemetryService,
  type LocalTelemetryFlushResult,
  type LocalTelemetryStatus,
  type TelemetryServiceStartResult,
  type TelemetryServiceStopResult
} from "../telemetry.js";

export async function telemetryFlush(context: CommandContext): Promise<LocalTelemetryFlushResult> {
  return flushLocalTelemetry(context, { force: true });
}

export async function telemetryStatus(context: CommandContext): Promise<LocalTelemetryStatus> {
  return localTelemetryStatus(context);
}

export async function telemetryStart(context: CommandContext): Promise<TelemetryServiceStartResult> {
  return startLocalTelemetryService(context);
}

export async function telemetryStop(context: CommandContext): Promise<TelemetryServiceStopResult> {
  return stopLocalTelemetryService(context);
}

export async function telemetryService(context: CommandContext): Promise<void> {
  await runLocalTelemetryService(context);
}
