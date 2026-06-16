import { bootstrap } from "./bootstrap.js";
import { DigitalOceanClient, publicIpv4 } from "../digitalocean.js";
import { readDigitalOceanState, stateAfterDestroy, stateWithActiveDroplet, writeDigitalOceanState } from "../infra-state.js";
import { resolveLayout } from "../paths.js";
import { SshRemoteClient } from "../remote.js";
import { RealShellExecutor } from "../shell.js";
import { ensureManagedSshKey } from "../ssh-key.js";
const defaultTimeoutMs = 10 * 60 * 1000;
export async function createDroplet(config, options = {}, executor = new RealShellExecutor()) {
    const client = createClient(config);
    const state = await readDigitalOceanState(config.projectSlug);
    const sshKey = await ensureManagedSshKey(config.projectSlug, executor);
    const accountKey = await ensureDigitalOceanSshKey(client, config.projectSlug, sshKey.publicKey);
    const name = options.name ?? config.digitalOcean.dropletName;
    const region = options.region ?? config.digitalOcean.region;
    const size = options.size ?? config.digitalOcean.size;
    const image = options.image ?? config.digitalOcean.image;
    if (state?.activeDroplet) {
        throw new Error(`A managed droplet is already active (${state.activeDroplet.id}, ${state.activeDroplet.ip}). Run droplet destroy first.`);
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
    const activeDroplet = {
        id: active.id,
        name: active.name,
        ip,
        region,
        size,
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
export async function dropletStatus(config) {
    const state = await readDigitalOceanState(config.projectSlug);
    if (!state?.activeDroplet) {
        return {
            active: false
        };
    }
    const client = createClient(config);
    const droplet = await client.getDroplet(state.activeDroplet.id);
    return {
        active: true,
        droplet: {
            id: droplet.id,
            name: droplet.name,
            status: droplet.status,
            locked: droplet.locked,
            ip: publicIpv4(droplet),
            region: droplet.region.slug,
            size: droplet.size_slug
        }
    };
}
export async function destroyDroplet(config, options = {}) {
    if (!options.yes) {
        throw new Error("Refusing to destroy the droplet without --yes.");
    }
    const state = await readDigitalOceanState(config.projectSlug);
    if (!state?.activeDroplet) {
        throw new Error("No active managed droplet is recorded for this project.");
    }
    const client = createClient(config);
    const dropletId = state.activeDroplet.id;
    await client.deleteDroplet(dropletId);
    await writeDigitalOceanState(stateAfterDestroy(config.projectSlug));
    return {
        dropletId,
        destroyed: true
    };
}
function createClient(config) {
    if (!config.digitalOcean.token) {
        throw new Error("DIGITALOCEAN_TOKEN or AGENT_RUNNER_DO_TOKEN is required for droplet lifecycle commands.");
    }
    return new DigitalOceanClient({ token: config.digitalOcean.token });
}
async function ensureDigitalOceanSshKey(client, projectSlug, publicKey) {
    const keys = await client.listSshKeys();
    const existing = keys.find((key) => key.public_key.trim() === publicKey.trim());
    if (existing) {
        return existing;
    }
    return client.createSshKey(`agent-runner-${projectSlug}`, publicKey);
}
async function waitForDropletReady(client, dropletId) {
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
async function waitForSsh(remote) {
    const started = Date.now();
    let lastError;
    while (Date.now() - started < defaultTimeoutMs) {
        try {
            await remote.run("true");
            return;
        }
        catch (error) {
            lastError = error;
            await sleep(5000);
        }
    }
    throw new Error(`Timed out waiting for SSH access. Last error: ${String(lastError)}`);
}
function configForActiveDroplet(config, activeDroplet) {
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
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=droplet.js.map