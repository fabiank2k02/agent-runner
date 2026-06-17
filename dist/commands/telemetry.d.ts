import type { CommandContext } from "../context.js";
import { type LocalTelemetryFlushResult, type LocalTelemetryStatus, type TelemetryServiceStartResult, type TelemetryServiceStopResult } from "../telemetry.js";
export declare function telemetryFlush(context: CommandContext): Promise<LocalTelemetryFlushResult>;
export declare function telemetryStatus(context: CommandContext): Promise<LocalTelemetryStatus>;
export declare function telemetryStart(context: CommandContext): Promise<TelemetryServiceStartResult>;
export declare function telemetryStop(context: CommandContext): Promise<TelemetryServiceStopResult>;
export declare function telemetryService(context: CommandContext): Promise<void>;
