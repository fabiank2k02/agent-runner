import type { CommandContext } from "../context.js";
import {
  devcontainerTelemetryAutostartStatus,
  installDevcontainerTelemetryAutostart,
  type DevcontainerTelemetryAutostartResult
} from "../devcontainer-autostart.js";
import {
  processTelemetryOnce,
  processorStatus,
  rebuildTelemetryProcessing,
  runProcessorService,
  startProcessorService,
  stopProcessorService,
  type ProcessorClientResult,
  type ProcessorServiceStartResult,
  type ProcessorServiceStopResult,
  type ProcessorStatusResult
} from "../telemetry-processor.js";
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

export async function telemetryAutostartInstall(context: CommandContext): Promise<DevcontainerTelemetryAutostartResult> {
  return installDevcontainerTelemetryAutostart(context.config.projectRoot);
}

export async function telemetryAutostartStatus(context: CommandContext): Promise<DevcontainerTelemetryAutostartResult> {
  return devcontainerTelemetryAutostartStatus(context.config.projectRoot);
}

export async function telemetryStop(context: CommandContext): Promise<TelemetryServiceStopResult> {
  return stopLocalTelemetryService(context);
}

export async function telemetryService(context: CommandContext): Promise<void> {
  await runLocalTelemetryService(context);
}

export async function telemetryProcessOnce(context: CommandContext): Promise<ProcessorClientResult> {
  return processTelemetryOnce(context);
}

export async function telemetryProcessorStart(context: CommandContext): Promise<ProcessorServiceStartResult> {
  return startProcessorService(context);
}

export async function telemetryProcessorStop(context: CommandContext): Promise<ProcessorServiceStopResult> {
  return stopProcessorService(context);
}

export async function telemetryProcessorStatus(context: CommandContext): Promise<ProcessorStatusResult> {
  return processorStatus(context);
}

export async function telemetryProcessorRebuild(context: CommandContext, scope: Record<string, unknown>): Promise<ProcessorClientResult> {
  return rebuildTelemetryProcessing(context, scope);
}

export async function telemetryProcessorService(context: CommandContext): Promise<void> {
  await runProcessorService(context);
}
