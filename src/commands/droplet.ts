import type { ResolvedConfig } from "../config.js";
import { bootstrap } from "./bootstrap.js";
import {
  DigitalOceanApiError,
  DigitalOceanClient,
  type DigitalOceanAction,
  isDigitalOceanNotFound,
  publicIpv4,
  type DigitalOceanDroplet,
  type DigitalOceanSnapshot
} from "../digitalocean.js";
import {
  readDigitalOceanState,
  stateAfterDestroy,
  stateWithActiveDroplet,
  stateWithFinalSnapshot,
  stateWithLifecycleTimings,
  stateWithProjectSnapshot,
  stateWithSnapshotCleanup,
  writeDigitalOceanState,
  type ActiveDropletState,
  type DigitalOceanState,
  type LifecycleTimingsState,
  type ManagedSnapshotState,
  type PhaseTimingState
} from "../infra-state.js";
import { resolveLayout } from "../paths.js";
import { quoteRemotePath } from "../quote.js";
import { SshRemoteClient } from "../remote.js";
import { RealShellExecutor, type ShellExecutor } from "../shell.js";
import { ensureManagedSshKey } from "../ssh-key.js";

const defaultTimeoutMs = 10 * 60 * 1000;
const snapshotTimeoutMs = 30 * 60 * 1000;

export interface DropletCreateOptions {
  name?: string;
  region?: string;
  size?: string;
  image?: string | number;
  skipBootstrap?: boolean;
  useProjectSnapshot?: boolean;
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
  snapshotUsed?: boolean;
  snapshotId?: string | number;
  snapshotName?: string;
  snapshotFallbackError?: string;
  timings?: LifecycleTimingsState;
}

export interface DropletDestroyResult {
  dropletId: number;
  destroyed: boolean;
  alreadyMissing?: boolean;
}

export interface ManagedSnapshotResult {
  snapshot: ManagedSnapshotState;
  deletedSnapshotIds: Array<string | number>;
  errors: string[];
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
  const projectSnapshot =
    options.image === undefined && options.useProjectSnapshot !== false
      ? await findReusableProjectSnapshot(client, config.projectSlug, state)
      : undefined;
  let image = options.image ?? projectSnapshot?.id ?? config.digitalOcean.image;
  let snapshotFallbackError: string | undefined;
  const timings: LifecycleTimingsState = {};
  const hourlyPriceUsd = await client.getSize(size).then((result) => result?.price_hourly).catch(() => undefined);

  if (state?.activeDroplet) {
    const refresh = await refreshManagedDroplet(config);
    if (refresh.active) {
      throw new Error(
        `A managed droplet is already active (${state.activeDroplet.id}, ${state.activeDroplet.ip}). Run droplet destroy first.`
      );
    }
  }

  const createTiming = startPhase();
  let droplet: DigitalOceanDroplet;
  try {
    droplet = await client.createDroplet({
      name,
      region,
      size,
      image,
      sshKeys: [accountKey.id],
      tags: config.digitalOcean.tags
    });
  } catch (error) {
    if (!projectSnapshot) {
      throw error;
    }
    snapshotFallbackError = error instanceof Error ? error.message : String(error);
    image = options.image ?? config.digitalOcean.image;
    droplet = await client.createDroplet({
      name,
      region,
      size,
      image,
      sshKeys: [accountKey.id],
      tags: config.digitalOcean.tags
    });
  }

  const active = await waitForDropletReady(client, droplet.id);
  timings.createRequestToDropletActive = finishPhase(createTiming);
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
    ...(projectSnapshot && !snapshotFallbackError
      ? {
          snapshotSourceId: projectSnapshot.id,
          snapshotSourceName: projectSnapshot.name
        }
      : {}),
    user: "root",
    sshKeyPath: sshKey.privateKeyPath,
    sshKeyId: accountKey.id,
    createdAt: new Date().toISOString()
  };

  await writeDigitalOceanState(stateWithActiveDroplet(config.projectSlug, activeDroplet, state));
  const managedConfig = configForActiveDroplet(config, activeDroplet);
  const remote = new SshRemoteClient(managedConfig, executor);
  const sshTiming = startPhase();
  await waitForSsh(remote);
  timings.dropletActiveToSshReady = finishPhase(sshTiming);

  let bootstrapped = false;
  const skipBootstrap = options.skipBootstrap || Boolean(projectSnapshot && !snapshotFallbackError);
  if (!skipBootstrap) {
    const bootstrapTiming = startPhase();
    await bootstrap({
      config: managedConfig,
      layout: resolveLayout(managedConfig),
      executor,
      remote,
      dryRun: false
    });
    timings.sshReadyToBootstrapComplete = finishPhase(bootstrapTiming);
    bootstrapped = true;
  } else {
    timings.sshReadyToBootstrapComplete = {
      skipped: true,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 0
    };
  }
  const latestState = await readDigitalOceanState(config.projectSlug);
  await writeDigitalOceanState(stateWithLifecycleTimings(config.projectSlug, timings, "startup", latestState));

  return {
    dropletId: activeDroplet.id,
    name: activeDroplet.name,
    ip: activeDroplet.ip,
    region: activeDroplet.region,
    size: activeDroplet.size,
    image: activeDroplet.image,
    bootstrapped,
    snapshotUsed: Boolean(projectSnapshot && !snapshotFallbackError),
    snapshotId: projectSnapshot && !snapshotFallbackError ? projectSnapshot.id : undefined,
    snapshotName: projectSnapshot && !snapshotFallbackError ? projectSnapshot.name : undefined,
    snapshotFallbackError,
    timings
  };
}

export async function dropletStatus(config: ResolvedConfig): Promise<Record<string, unknown>> {
  const refresh = await refreshManagedDroplet(config);
  const state = await readDigitalOceanState(config.projectSlug);
  if (!refresh.active) {
    return {
      active: false,
      staleCleared: refresh.staleCleared,
      staleDroplet: refresh.staleDroplet,
      projectSnapshot: state?.projectSnapshot,
      previousSnapshot: state?.previousSnapshot,
      lastFinalSnapshot: state?.lastFinalSnapshot,
      lastStartupTimings: state?.lastStartupTimings,
      lastFinishTimings: state?.lastFinishTimings,
      lastCleanup: state?.lastCleanup
    };
  }

  return {
    active: true,
    droplet: refresh.droplet,
    projectSnapshot: state?.projectSnapshot,
    previousSnapshot: state?.previousSnapshot,
    lastFinalSnapshot: state?.lastFinalSnapshot,
    lastStartupTimings: state?.lastStartupTimings,
    lastFinishTimings: state?.lastFinishTimings,
    lastCleanup: state?.lastCleanup
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
    await writeDigitalOceanState(stateAfterDestroy(config.projectSlug, state));
    return {
      dropletId,
      destroyed: false,
      alreadyMissing: true
    };
  }
  await writeDigitalOceanState(stateAfterDestroy(config.projectSlug, state));

  return {
    dropletId,
    destroyed: true
  };
}

export async function createFinalProjectSnapshot(
  config: ResolvedConfig,
  options: { sourceDropletId?: number; name?: string } = {}
): Promise<ManagedSnapshotResult> {
  const client = createClient(config);
  const state = await readDigitalOceanState(config.projectSlug);
  const activeDroplet = state?.activeDroplet;
  const sourceDropletId = options.sourceDropletId ?? activeDroplet?.id;
  if (!sourceDropletId) {
    throw new Error("No active managed droplet is recorded for snapshot creation.");
  }

  const snapshotName = options.name ?? projectSnapshotName(config.projectSlug);
  const snapshot = await createSnapshot(client, config.projectSlug, sourceDropletId, snapshotName, "project");
  const nextState = {
    ...stateWithProjectSnapshot(config.projectSlug, snapshot, state),
    lastFinalSnapshot: snapshot
  };
  await writeDigitalOceanState(nextState);
  const cleanup = await cleanupProjectSnapshots(config, { state: nextState });
  return {
    snapshot,
    deletedSnapshotIds: cleanup.deletedSnapshotIds,
    errors: cleanup.errors
  };
}

export async function cleanupProjectSnapshots(
  config: ResolvedConfig,
  options: { state?: DigitalOceanState; keepPrevious?: boolean } = {}
): Promise<{ deletedSnapshotIds: Array<string | number>; errors: string[] }> {
  const client = createClient(config);
  const state = options.state ?? await readDigitalOceanState(config.projectSlug);
  const snapshots = await listManagedProjectSnapshots(client, config.projectSlug);
  const keep = new Set<string>();
  if (state?.projectSnapshot?.id) {
    keep.add(String(state.projectSnapshot.id));
  }
  if (options.keepPrevious !== false && state?.previousSnapshot?.id) {
    keep.add(String(state.previousSnapshot.id));
  }

  const sorted = snapshots.sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
  for (const snapshot of sorted) {
    if (keep.size >= 2) {
      break;
    }
    keep.add(String(snapshot.id));
  }

  const deletedSnapshotIds: Array<string | number> = [];
  const errors: string[] = [];
  for (const snapshot of sorted) {
    if (keep.has(String(snapshot.id))) {
      continue;
    }
    try {
      await client.deleteSnapshot(snapshot.id);
      deletedSnapshotIds.push(snapshot.id);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const latest = await readDigitalOceanState(config.projectSlug);
  await writeDigitalOceanState(
    stateWithSnapshotCleanup(
      config.projectSlug,
      {
        deletedSnapshotIds,
        checkedAt: new Date().toISOString(),
        errors
      },
      latest
    )
  );
  return { deletedSnapshotIds, errors };
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
    await writeDigitalOceanState(stateAfterDestroy(config.projectSlug, state));
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

async function findReusableProjectSnapshot(
  client: DigitalOceanClient,
  projectSlug: string,
  state?: DigitalOceanState
): Promise<DigitalOceanSnapshot | undefined> {
  const snapshots = await listManagedProjectSnapshots(client, projectSlug);
  if (state?.projectSnapshot?.id) {
    const byState = snapshots.find((snapshot) => String(snapshot.id) === String(state.projectSnapshot?.id));
    if (byState) {
      return byState;
    }
  }
  return snapshots
    .filter((snapshot) => snapshot.name.includes("-project-"))
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))[0];
}

async function listManagedProjectSnapshots(client: DigitalOceanClient, projectSlug: string): Promise<DigitalOceanSnapshot[]> {
  const prefix = snapshotPrefix(projectSlug);
  const snapshots = await client.listDropletSnapshots();
  return snapshots.filter((snapshot) => snapshot.name.startsWith(prefix));
}

async function createSnapshot(
  client: DigitalOceanClient,
  projectSlug: string,
  dropletId: number,
  name: string,
  role: ManagedSnapshotState["role"]
): Promise<ManagedSnapshotState> {
  const action = await client.createDropletSnapshot(dropletId, name);
  await waitForActionComplete(client, dropletId, action);
  const snapshot = await waitForSnapshotVisible(client, dropletId, name);
  return {
    id: snapshot.id,
    name: snapshot.name,
    projectSlug,
    sourceDropletId: dropletId,
    createdAt: snapshot.created_at,
    role,
    sizeGigabytes: snapshot.size_gigabytes
  };
}

async function waitForActionComplete(
  client: DigitalOceanClient,
  dropletId: number,
  initialAction: DigitalOceanAction
): Promise<DigitalOceanAction> {
  const started = Date.now();
  let action = initialAction;
  while (Date.now() - started < snapshotTimeoutMs) {
    if (action.status === "completed") {
      return action;
    }
    if (action.status === "errored") {
      throw new Error(`DigitalOcean action ${action.id} failed while creating snapshot.`);
    }
    await sleep(10_000);
    action = await client.getDropletAction(dropletId, action.id);
  }
  throw new Error(`Timed out waiting for DigitalOcean action ${initialAction.id} to complete.`);
}

async function waitForSnapshotVisible(
  client: DigitalOceanClient,
  dropletId: number,
  name: string
): Promise<DigitalOceanSnapshot> {
  const started = Date.now();
  while (Date.now() - started < defaultTimeoutMs) {
    const snapshots = await client.listDropletSnapshots();
    const snapshot = snapshots.find(
      (item) => item.name === name && String(item.resource_id) === String(dropletId) && item.resource_type === "droplet"
    );
    if (snapshot) {
      return snapshot;
    }
    await sleep(5000);
  }
  throw new Error(`Snapshot ${name} was not visible after the snapshot action completed.`);
}

function projectSnapshotName(projectSlug: string, date = new Date()): string {
  return `${snapshotPrefix(projectSlug)}project-${timestampForName(date)}`;
}

function snapshotPrefix(projectSlug: string): string {
  return `agent-runner-${safeName(projectSlug)}-`;
}

function timestampForName(date: Date): string {
  return date.toISOString().replace(/[-:]/gu, "").replace(/\..+$/u, "Z");
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 80) || "project";
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

function startPhase(): { startedAt: string; startedMs: number } {
  return {
    startedAt: new Date().toISOString(),
    startedMs: Date.now()
  };
}

function finishPhase(phase: { startedAt: string; startedMs: number }, error?: unknown): PhaseTimingState {
  return {
    startedAt: phase.startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Math.max(0, Date.now() - phase.startedMs),
    ...(error ? { error: error instanceof Error ? error.message : String(error) } : {})
  };
}
