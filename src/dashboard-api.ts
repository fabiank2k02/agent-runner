import type { ResolvedConfig } from "./config.js";

export interface DashboardJsonResponse<T = Record<string, unknown>> {
  response: Response;
  body: T;
}

export function dashboardAuthHeaders(
  dashboard: ResolvedConfig["dashboard"],
  options: { contentType?: boolean } = {}
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (dashboard.token) {
    headers.authorization = `Bearer ${dashboard.token}`;
  }
  if (dashboard.accessClientId && dashboard.accessClientSecret) {
    headers["CF-Access-Client-Id"] = dashboard.accessClientId;
    headers["CF-Access-Client-Secret"] = dashboard.accessClientSecret;
  }
  if (options.contentType) {
    headers["content-type"] = "application/json";
  }
  return headers;
}

export function dashboardApiUrl(endpoint: string, pathname: string): string {
  const url = new URL(endpoint);
  url.pathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function readDashboardJson<T = Record<string, unknown>>(
  response: Response,
  label: string
): Promise<DashboardJsonResponse<T>> {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  const trimmed = text.trimStart();
  if (!contentType.toLowerCase().includes("application/json")) {
    const summary = summarizeNonJsonBody(trimmed || text);
    throw new Error(`${label} returned non-JSON response (${response.status} ${contentType || "unknown content-type"}): ${summary}`);
  }
  try {
    return { response, body: JSON.parse(text || "{}") as T };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} returned invalid JSON (${response.status}): ${message}`);
  }
}

function summarizeNonJsonBody(value: string): string {
  const oneLine = value.replace(/\s+/gu, " ").slice(0, 220);
  if (/cloudflare access|cf-access|<html|<!doctype html/iu.test(value)) {
    return `Cloudflare Access or HTML page detected: ${oneLine}`;
  }
  return oneLine || "empty body";
}
