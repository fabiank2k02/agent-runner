import { cleanupDashboardLiveTestData } from "../dashboard-cleanup.js";
import { devcontainerTelemetryAutostartStatus, installDevcontainerTelemetryAutostart } from "../devcontainer-autostart.js";
import { processTelemetryOnce, processorStatus, rebuildTelemetryProcessing, runProcessorService, startProcessorService, stopProcessorService } from "../telemetry-processor.js";
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
export async function telemetryAutostartInstall(context) {
    return installDevcontainerTelemetryAutostart(context.config.projectRoot);
}
export async function telemetryAutostartStatus(context) {
    return devcontainerTelemetryAutostartStatus(context.config.projectRoot);
}
export async function telemetryStop(context) {
    return stopLocalTelemetryService(context);
}
export async function telemetryService(context) {
    await runLocalTelemetryService(context);
}
export async function telemetryProcessOnce(context) {
    return processTelemetryOnce(context);
}
export async function telemetryProcessorStart(context) {
    return startProcessorService(context);
}
export async function telemetryProcessorStop(context) {
    return stopProcessorService(context);
}
export async function telemetryProcessorStatus(context) {
    return processorStatus(context);
}
export async function telemetryProcessorRebuild(context, scope) {
    return rebuildTelemetryProcessing(context, scope);
}
export async function telemetryProcessorService(context) {
    await runProcessorService(context);
}
export async function telemetryCleanupLiveTest(context, prefix) {
    return cleanupDashboardLiveTestData(context, prefix);
}
//# sourceMappingURL=telemetry.js.map