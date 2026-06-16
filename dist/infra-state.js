import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
const activeDropletSchema = z.object({
    id: z.number(),
    name: z.string(),
    ip: z.string(),
    region: z.string(),
    size: z.string(),
    hourlyPriceUsd: z.number().optional(),
    image: z.union([z.string(), z.number()]),
    user: z.string().default("root"),
    sshKeyPath: z.string(),
    sshKeyId: z.number().optional(),
    createdAt: z.string()
});
const digitalOceanStateSchema = z
    .object({
    version: z.literal(1),
    projectSlug: z.string(),
    activeDroplet: activeDropletSchema.optional(),
    updatedAt: z.string()
})
    .default({
    version: 1,
    projectSlug: "",
    updatedAt: ""
});
export function digitalOceanStateDir() {
    return path.join(os.homedir(), ".agent-runner", "digitalocean");
}
export function digitalOceanStateFile(projectSlug) {
    return path.join(digitalOceanStateDir(), `${projectSlug}.json`);
}
export function readDigitalOceanStateSync(projectSlug) {
    const stateFile = digitalOceanStateFile(projectSlug);
    if (!fs.existsSync(stateFile)) {
        return undefined;
    }
    const raw = fs.readFileSync(stateFile, "utf8");
    return digitalOceanStateSchema.parse(JSON.parse(raw));
}
export async function readDigitalOceanState(projectSlug) {
    const stateFile = digitalOceanStateFile(projectSlug);
    if (!fs.existsSync(stateFile)) {
        return undefined;
    }
    const raw = await fs.promises.readFile(stateFile, "utf8");
    return digitalOceanStateSchema.parse(JSON.parse(raw));
}
export async function writeDigitalOceanState(state) {
    await fs.promises.mkdir(digitalOceanStateDir(), { recursive: true });
    await fs.promises.writeFile(digitalOceanStateFile(state.projectSlug), `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`);
}
export function stateWithActiveDroplet(projectSlug, activeDroplet, existing) {
    return {
        version: 1,
        projectSlug,
        activeDroplet,
        updatedAt: new Date().toISOString()
    };
}
export function stateAfterDestroy(projectSlug) {
    return {
        version: 1,
        projectSlug,
        activeDroplet: undefined,
        updatedAt: new Date().toISOString()
    };
}
//# sourceMappingURL=infra-state.js.map