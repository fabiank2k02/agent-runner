import fs from "node:fs";
import path from "node:path";
import type { CommandContext } from "../context.js";
import { refreshManagedDroplet } from "./droplet.js";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorResult {
  ok: boolean;
  checks: DoctorCheck[];
}

export async function doctor(context: CommandContext): Promise<DoctorResult> {
  const checks: DoctorCheck[] = [];
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
    ok: !config.dashboard.enabled || Boolean(config.dashboard.endpoint && config.dashboard.token),
    detail: config.dashboard.enabled
      ? config.dashboard.endpoint && config.dashboard.token
        ? `enabled; posting to ${config.dashboard.endpoint}`
        : `enabled; set AGENT_RUNNER_DASHBOARD_ENDPOINT and ${config.dashboard.tokenEnv}`
      : "not set; optional"
  });

  return {
    ok: checks.every((check) => check.ok),
    checks
  };
}

async function commandCheck(
  executor: CommandContext["executor"],
  command: string,
  args: string[],
  name: string,
  cwd?: string
): Promise<DoctorCheck> {
  const result = await executor.run(command, args, { cwd });
  return {
    name,
    ok: result.exitCode === 0,
    detail: result.exitCode === 0 ? (result.stdout || result.stderr || "ok").split("\n")[0] : result.stderr || result.stdout
  };
}
