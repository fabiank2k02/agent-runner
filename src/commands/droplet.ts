import type { ResolvedConfig } from "../config.js";
import { bootstrap } from "./bootstrap.js";
import {
  DigitalOceanClient,
  isDigitalOceanNotFound,
  publicIpv4,
  type DigitalOceanDroplet
} from "../digitalocean.js";
import {
  readDigitalOceanState,
  stateAfterDestroy,
  stateWithActiveDroplet,
  writeDigitalOceanState,
  type ActiveDropletState
} from "../infra-state.js";
import { resolveLayout } from "../paths.js";
import { quoteRemotePath } from "../quote.js";
import { SshRemoteClient } from "../remote.js";
import { RealShellExecutor, type ShellExecutor } from "../shell.js";
import { ensureManagedSshKey } from "../ssh-key.js";

const defaultTimeoutMs = 10 * 60 * 1000;

export interface DropletCreateOptions {
  name?: string;
  region?: string;
  size?: string;
  image?: string | number;
  skipBootstrap?: boolean;
}

export interface DropletDestroyOptions {
  yes?: boolean;
}

export interface DropletLifecycleResult {
  dropletId: number;
  name: string;
  ip: string;
  region: string;
  size: string;
  image: string | number;
  bootstrapped: boolean;
}

export interface DropletDestroyResult {
  dropletId: number;
  destroyed: boolean;
  alreadyMissing?: boolean;
}

export interface ManagedDropletRefreshResult {
  active: boolean;
  staleCleared: boolean;
  droplet?: {
    id: number;
    name: string;
    status: string;
    locked: boolean;
    ip?: string;
    region: string;
    size: string;
    hourlyPriceUsd?: number;
  };
  staleDroplet?: ActiveDropletState;
}

export async function createDroplet(
  config: ResolvedConfig,
  options: DropletCreateOptions = {},
  executor: ShellExecutor = new RealShellExecutor()
): Promise<DropletLifecycleResult> {
  const client = createClient(config);
  const state = await readDigitalOceanState(config.projectSlug);
  const sshKey = await ensureManagedSshKey(config.projectSlug, executor);
  const accountKey = await ensureDigitalOceanSshKey(client, config.projectSlug, sshKey.publicKey);
  const name = options.name ?? config.digitalOcean.dropletName;
  const region = options.region ?? config.digitalOcean.region;
  const size = options.size ?? config.digitalOcean.size;
  const image = options.image ?? config.digitalOcean.image;
  const hourlyPriceUsd = await client.getSize(size).then((result) => result?.price_hourly).catch(() => undefined);

  if (state?.activeDroplet) {
    const refresh = await refreshManagedDroplet(config);
    if (refresh.active) {
      throw new Error(
        `A managed droplet is already active (${state.activeDroplet.id}, ${state.activeDroplet.ip}). Run droplet destroy first.`
      );
    }
  }

  const droplet = await client.createDroplet({
    name,
    region,
    size,
    image,
    sshKeys: [accountKey.id],
    tags: config.digitalOcean.tags
  });

  const active = await waitForDropletReady(client, droplet.id);
  const ip = publicIpv4(active);
  if (!ip) {
    throw new Error(`Droplet ${active.id} became active without a public IPv4 address.`);
  }

  const activeDroplet: ActiveDropletState = {
    id: active.id,
    name: active.name,
    ip,
    region,
    size,
    hourlyPriceUsd,
    image,
    user: "root",
    sshKeyPath: sshKey.privateKeyPath,
    sshKeyId: accountKey.id,
    createdAt: new Date().toISOString()
  };

  await writeDigitalOceanState(stateWithActiveDroplet(config.projectSlug, activeDroplet, state));
  const managedConfig = configForActiveDroplet(config, activeDroplet);
  const remote = new SshRemoteClient(managedConfig, executor);
  await waitForSsh(remote);

  let bootstrapped = false;
  if (!options.skipBootstrap) {
    await bootstrap({
      config: managedConfig,
      layout: resolveLayout(managedConfig),
      executor,
      remote,
      dryRun: false
    });
    bootstrapped = true;
  }

  return {
    dropletId: activeDroplet.id,
    name: activeDroplet.name,
    ip: activeDroplet.ip,
    region: activeDroplet.region,
    size: activeDroplet.size,
    image: activeDroplet.image,
    bootstrapped
  };
}

export async function dropletStatus(config: ResolvedConfig): Promise<Record<string, unknown>> {
  const refresh = await refreshManagedDroplet(config);
  if (!refresh.active) {
    return {
      active: false,
      staleCleared: refresh.staleCleared,
      staleDroplet: refresh.staleDroplet
    };
  }

  return {
    active: true,
    droplet: refresh.droplet
  };
}

export async function destroyDroplet(
  config: ResolvedConfig,
  options: DropletDestroyOptions = {}
): Promise<DropletDestroyResult> {
  if (!options.yes) {
    throw new Error("Refusing to destroy the droplet without --yes.");
  }

  const state = await readDigitalOceanState(config.projectSlug);
  if (!state?.activeDroplet) {
    throw new Error("No active managed droplet is recorded for this project.");
  }

  const client = createClient(config);
  const dropletId = state.activeDroplet.id;
  try {
    await client.deleteDroplet(dropletId);
  } catch (error) {
    if (!isDigitalOceanNotFound(error)) {
      throw error;
    }
    await writeDigitalOceanState(stateAfterDestroy(config.projectSlug));
    return {
      dropletId,
      destroyed: false,
      alreadyMissing: true
    };
  }
  await writeDigitalOceanState(stateAfterDestroy(config.projectSlug));

  return {
    dropletId,
    destroyed: true
  };
}

export async function refreshManagedDroplet(config: ResolvedConfig): Promise<ManagedDropletRefreshResult> {
  const state = await readDigitalOceanState(config.projectSlug);
  if (!state?.activeDroplet) {
    return { active: false, staleCleared: false };
  }

  const client = createClient(config);
  try {
    const droplet = await client.getDroplet(state.activeDroplet.id);
    return {
      active: true,
      staleCleared: false,
      droplet: {
        id: droplet.id,
        name: droplet.name,
        status: droplet.status,
        locked: droplet.locked,
        ip: publicIpv4(droplet),
        region: droplet.region.slug,
        size: droplet.size_slug,
        hourlyPriceUsd: state.activeDroplet.hourlyPriceUsd
      }
    };
  } catch (error) {
    if (!isDigitalOceanNotFound(error)) {
      throw error;
    }
    await writeDigitalOceanState(stateAfterDestroy(config.projectSlug));
    return {
      active: false,
      staleCleared: true,
      staleDroplet: state.activeDroplet
    };
  }
}

function createClient(config: ResolvedConfig): DigitalOceanClient {
  if (!config.digitalOcean.token) {
    throw new Error("DIGITALOCEAN_TOKEN or AGENT_RUNNER_DO_TOKEN is required for droplet lifecycle commands.");
  }
  return new DigitalOceanClient({ token: config.digitalOcean.token });
}

async function ensureDigitalOceanSshKey(
  client: DigitalOceanClient,
  projectSlug: string,
  publicKey: string
): Promise<{ id: number; name: string }> {
  const keys = await client.listSshKeys();
  const existing = keys.find((key) => key.public_key.trim() === publicKey.trim());
  if (existing) {
    return existing;
  }
  return client.createSshKey(`agent-runner-${projectSlug}`, publicKey);
}

async function waitForDropletReady(client: DigitalOceanClient, dropletId: number): Promise<DigitalOceanDroplet> {
  const started = Date.now();
  while (Date.now() - started < defaultTimeoutMs) {
    const droplet = await client.getDroplet(dropletId);
    if (droplet.status === "active" && publicIpv4(droplet)) {
      return droplet;
    }
    await sleep(5000);
  }
  throw new Error(`Timed out waiting for droplet ${dropletId} to become active.`);
}

async function waitForSsh(remote: SshRemoteClient): Promise<void> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < defaultTimeoutMs) {
    try {
      await remote.run("true");
      return;
    } catch (error) {
      lastError = error;
      await sleep(5000);
    }
  }
  throw new Error(`Timed out waiting for SSH access. Last error: ${String(lastError)}`);
}


function configForActiveDroplet(config: ResolvedConfig, activeDroplet: ActiveDropletState): ResolvedConfig {
  return {
    ...config,
    remote: {
      ...config.remote,
      host: activeDroplet.ip,
      user: activeDroplet.user,
      sshKey: activeDroplet.sshKeyPath,
      password: undefined
    }
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
