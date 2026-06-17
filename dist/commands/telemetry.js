import { flushLocalTelemetry, localTelemetryStatus, runLocalTelemetryService, startLocalTelemetryService, stopLocalTelemetryService } from "../telemetry.js";
export async function telemetryFlush(context) {
    return flushLocalTelemetry(context, { force: true });
}
export async function telemetryStatus(context) {
    return localTelemetryStatus(context);
}
export async function telemetryStart(context) {
    return startLocalTelemetryService(context);
}
export async function telemetryStop(context) {
    return stopLocalTelemetryService(context);
}
export async function telemetryService(context) {
    await runLocalTelemetryService(context);
}
//# sourceMappingURL=telemetry.js.map