import type { CommandContext } from "./context.js";
import { dashboardApiUrl, dashboardAuthHeaders, readDashboardJson } from "./dashboard-api.js";

export interface DashboardTestCleanupResult {
  ok: boolean;
  prefix: string;
  deleted: Record<string, number | null>;
  r2ObjectsDeleted: number;
  r2KeysDeleted: string[];
  r2Errors: Array<{ key: string; error: string }>;
  remaining: Record<string, number>;
}

export async function cleanupDashboardLiveTestData(
  context: CommandContext,
  prefix: string
): Promise<DashboardTestCleanupResult> {
  requireDashboardCleanupConfig(context);
  const response = await fetch(dashboardApiUrl(context.config.dashboard.endpoint!, "/api/admin/test-cleanup"), {
    method: "POST",
    headers: dashboardAuthHeaders(context.config.dashboard, { contentType: true }),
    body: JSON.stringify({ prefix })
  });
  const { body } = await readDashboardJson<DashboardTestCleanupResult & { error?: string }>(response, "dashboard test cleanup");
  if (!response.ok) {
    throw new Error(body?.error || `dashboard test cleanup failed: ${response.status}`);
  }
  return body;
}

function requireDashboardCleanupConfig(context: CommandContext): void {
  const dashboard = context.config.dashboard;
  if (!dashboard.endpoint || !(dashboard.token || (dashboard.accessClientId && dashboard.accessClientSecret))) {
    throw new Error(
      `Dashboard test cleanup requires AGENT_RUNNER_DASHBOARD_ENDPOINT and either ${dashboard.tokenEnv} or AGENT_RUNNER_CF_ACCESS_CLIENT_ID/AGENT_RUNNER_CF_ACCESS_CLIENT_SECRET.`
    );
  }
}
