import { dashboardApiUrl, dashboardAuthHeaders, readDashboardJson } from "./dashboard-api.js";
export async function cleanupDashboardLiveTestData(context, prefix) {
    requireDashboardCleanupConfig(context);
    const response = await fetch(dashboardApiUrl(context.config.dashboard.endpoint, "/api/admin/test-cleanup"), {
        method: "POST",
        headers: dashboardAuthHeaders(context.config.dashboard, { contentType: true }),
        body: JSON.stringify({ prefix })
    });
    const { body } = await readDashboardJson(response, "dashboard test cleanup");
    if (!response.ok) {
        throw new Error(body?.error || `dashboard test cleanup failed: ${response.status}`);
    }
    return body;
}
function requireDashboardCleanupConfig(context) {
    const dashboard = context.config.dashboard;
    if (!dashboard.endpoint || !(dashboard.token || (dashboard.accessClientId && dashboard.accessClientSecret))) {
        throw new Error(`Dashboard test cleanup requires AGENT_RUNNER_DASHBOARD_ENDPOINT and either ${dashboard.tokenEnv} or AGENT_RUNNER_CF_ACCESS_CLIENT_ID/AGENT_RUNNER_CF_ACCESS_CLIENT_SECRET.`);
    }
}
//# sourceMappingURL=dashboard-cleanup.js.map