import fs from "node:fs";
import path from "node:path";
import { refreshManagedDroplet } from "./droplet.js";
export async function doctor(context) {
    const checks = [];
    const { config, executor } = context;
    const hasManagedDigitalOcean = Boolean(config.digitalOcean.token);
    const managedRefresh = hasManagedDigitalOcean
        ? await refreshManagedDroplet(config)
        : { active: false, staleCleared: false };
    const hasRemote = Boolean(config.remote.host) && !managedRefresh.staleCleared;
    checks.push(await commandCheck(executor, "ssh", ["-V"], "ssh"));
    checks.push(await commandCheck(executor, "rsync", ["--version"], "rsync"));
    checks.push(await commandCheck(executor, "sh", ["-lc", "command -v ssh-keygen"], "ssh-keygen"));
    if (config.remote.password) {
        checks.push(await commandCheck(executor, "sshpass", ["-V"], "sshpass"));
    }
    checks.push(await commandCheck(executor, "git", ["rev-parse", "--is-inside-work-tree"], "git repository", config.projectRoot));
    const devcontainerDir = path.join(config.projectRoot, ".devcontainer");
    checks.push({
        name: ".devcontainer",
        ok: fs.existsSync(devcontainerDir),
        detail: fs.existsSync(devcontainerDir) ? devcontainerDir : "missing .devcontainer directory"
    });
    checks.push({
        name: "remote host",
        ok: hasRemote || hasManagedDigitalOcean,
        detail: hasRemote
            ? config.remote.host ?? ""
            : managedRefresh.staleCleared
                ? `stale managed droplet state cleared (${managedRefresh.staleDroplet?.id}); managed DigitalOcean droplet will be created`
                : hasManagedDigitalOcean
                    ? "managed DigitalOcean droplet will be created"
                    : "AGENT_RUNNER_REMOTE_HOST is not set"
    });
    checks.push({
        name: "remote user",
        ok: Boolean(config.remote.user) || hasManagedDigitalOcean,
        detail: config.remote.user ?? (hasManagedDigitalOcean ? "managed DigitalOcean droplet will use root" : "AGENT_RUNNER_REMOTE_USER is not set")
    });
    checks.push({
        name: "remote password",
        ok: Boolean(config.remote.password || config.remote.sshKey) || hasManagedDigitalOcean,
        detail: config.remote.password
            ? "AGENT_RUNNER_REMOTE_PASSWORD is set"
            : config.remote.sshKey
                ? "SSH key fallback is configured"
                : hasManagedDigitalOcean
                    ? "managed DigitalOcean SSH key will be generated"
                    : "AGENT_RUNNER_REMOTE_PASSWORD is not set"
    });
    checks.push({
        name: "codex auth source",
        ok: fs.existsSync(config.codexAuthSource),
        detail: fs.existsSync(config.codexAuthSource)
            ? config.codexAuthSource
            : `${config.codexAuthSource} does not exist`
    });
    checks.push({
        name: "DigitalOcean token",
        ok: true,
        detail: config.digitalOcean.token
            ? "DIGITALOCEAN_TOKEN or AGENT_RUNNER_DO_TOKEN is set"
            : "not set; required only for droplet create/destroy"
    });
    checks.push({
        name: "dashboard",
        ok: Boolean(config.dashboard.enabled && config.dashboard.endpoint && hasDashboardAuth(config.dashboard)),
        detail: config.dashboard.enabled && config.dashboard.endpoint && hasDashboardAuth(config.dashboard)
            ? `enabled; posting to ${config.dashboard.endpoint}`
            : `required; set AGENT_RUNNER_DASHBOARD_ENDPOINT and ${config.dashboard.tokenEnv} or Access service-token env`
    });
    checks.push(...await cloudflareChecks(context));
    return {
        ok: checks.every((check) => check.ok),
        checks
    };
}
function hasDashboardAuth(dashboard) {
    return Boolean(dashboard.token || (dashboard.accessClientId && dashboard.accessClientSecret));
}
async function cloudflareChecks(context) {
    const primaryToken = process.env.CLOUDFLARE_TOKEN;
    const aliasToken = process.env.CLOUDFLARE_API_TOKEN;
    const token = primaryToken || aliasToken;
    const checks = [
        {
            name: "Cloudflare token",
            ok: true,
            detail: token ? `present: yes (${primaryToken ? "CLOUDFLARE_TOKEN" : "CLOUDFLARE_API_TOKEN alias"})` : "present: no; dashboard deploy checks skipped"
        }
    ];
    if (!token) {
        checks.push({
            name: "Cloudflare Pages deploy permission",
            ok: true,
            detail: "not checked; set CLOUDFLARE_TOKEN to verify"
        }, {
            name: "Cloudflare Access policy permission",
            ok: true,
            detail: "not checked; required only if Access path policy updates are needed"
        }, {
            name: "Cloudflare D1 query permission",
            ok: true,
            detail: "not checked; set CLOUDFLARE_TOKEN to verify"
        }, {
            name: "Cloudflare R2 list/delete permission",
            ok: true,
            detail: "not checked; set CLOUDFLARE_TOKEN to verify"
        });
        return checks;
    }
    const bindings = readDashboardBindings(context.config.projectRoot);
    const accounts = await cloudflareFetch(token, "/accounts");
    const accountId = Array.isArray(accounts.result) ? accounts.result[0]?.id : undefined;
    checks.push({
        name: "Cloudflare account API",
        ok: accounts.ok && Boolean(accountId),
        detail: accounts.ok && accountId ? "account lookup verified" : accounts.detail
    });
    if (!accountId) {
        return checks;
    }
    const pages = await cloudflareFetch(token, `/accounts/${accountId}/pages/projects/agent-runner-dashboard`);
    checks.push({
        name: "Cloudflare Pages deploy permission",
        ok: pages.ok,
        detail: pages.ok ? "Pages project access verified" : pages.detail
    });
    const access = await cloudflareFetch(token, `/accounts/${accountId}/access/apps`);
    checks.push({
        name: "Cloudflare Access policy permission",
        ok: access.ok,
        detail: access.ok ? "Access application access verified" : access.detail
    });
    if (bindings.databaseId) {
        const query = await cloudflareFetch(token, `/accounts/${accountId}/d1/database/${bindings.databaseId}/query`, {
            method: "POST",
            body: { sql: "SELECT 1 AS ok" }
        });
        checks.push({
            name: "Cloudflare D1 query permission",
            ok: query.ok,
            detail: query.ok ? "D1 query verified" : query.detail
        });
        const write = query.ok
            ? await verifyD1Write(token, accountId, bindings.databaseId)
            : { ok: false, detail: "D1 query failed; write not attempted" };
        checks.push({
            name: "Cloudflare D1 write permission",
            ok: write.ok,
            detail: write.detail
        });
    }
    else {
        checks.push({
            name: "Cloudflare D1 query permission",
            ok: false,
            detail: "dashboard/wrangler.toml database_id not found"
        });
    }
    if (bindings.r2Bucket) {
        const r2 = await cloudflareFetch(token, `/accounts/${accountId}/r2/buckets/${encodeURIComponent(bindings.r2Bucket)}/objects`);
        checks.push({
            name: "Cloudflare R2 list/delete permission",
            ok: r2.ok,
            detail: r2.ok ? "R2 list verified; delete verified by guarded live-test cleanup when objects exist" : r2.detail
        });
    }
    else {
        checks.push({
            name: "Cloudflare R2 list/delete permission",
            ok: false,
            detail: "dashboard/wrangler.toml bucket_name not found"
        });
    }
    return checks;
}
async function verifyD1Write(token, accountId, databaseId) {
    const id = `doctor:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const now = new Date().toISOString();
    const insert = await cloudflareFetch(token, `/accounts/${accountId}/d1/database/${databaseId}/query`, {
        method: "POST",
        body: {
            sql: "INSERT OR REPLACE INTO processing_leases (id, owner_id, acquired_at, expires_at, heartbeat_at, metadata_json) VALUES (?, ?, ?, ?, ?, ?)",
            params: [id, "doctor", now, now, now, "{\"source\":\"doctor\"}"]
        }
    });
    if (!insert.ok) {
        return { ok: false, detail: insert.detail };
    }
    const cleanup = await cloudflareFetch(token, `/accounts/${accountId}/d1/database/${databaseId}/query`, {
        method: "POST",
        body: {
            sql: "DELETE FROM processing_leases WHERE id = ?",
            params: [id]
        }
    });
    return {
        ok: cleanup.ok,
        detail: cleanup.ok ? "D1 write/delete verified with diagnostic row" : `write succeeded but cleanup failed: ${cleanup.detail}`
    };
}
async function cloudflareFetch(token, apiPath, options = {}) {
    try {
        const response = await fetch(`https://api.cloudflare.com/client/v4${apiPath}`, {
            method: options.method || "GET",
            headers: {
                authorization: `Bearer ${token}`,
                ...(options.body ? { "content-type": "application/json" } : {})
            },
            body: options.body ? JSON.stringify(options.body) : undefined
        });
        const body = await response.json();
        if (response.ok && body.success !== false) {
            return { ok: true, detail: "ok", result: body.result };
        }
        const errors = body.errors?.map((error) => `${error.code || "error"} ${error.message || ""}`.trim()).join("; ");
        return { ok: false, detail: `${response.status} ${errors || response.statusText}` };
    }
    catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
}
function readDashboardBindings(projectRoot) {
    try {
        const raw = fs.readFileSync(path.join(projectRoot, "dashboard", "wrangler.toml"), "utf8");
        return {
            databaseId: raw.match(/database_id\s*=\s*"([^"]+)"/u)?.[1],
            r2Bucket: raw.match(/bucket_name\s*=\s*"([^"]+)"/u)?.[1]
        };
    }
    catch {
        return {};
    }
}
async function commandCheck(executor, command, args, name, cwd) {
    const result = await executor.run(command, args, { cwd });
    return {
        name,
        ok: result.exitCode === 0,
        detail: result.exitCode === 0 ? (result.stdout || result.stderr || "ok").split("\n")[0] : result.stderr || result.stdout
    };
}
//# sourceMappingURL=doctor.js.map