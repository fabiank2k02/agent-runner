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

export type ActiveDropletState = z.infer<typeof activeDropletSchema>;
export type DigitalOceanState = z.infer<typeof digitalOceanStateSchema>;

export function digitalOceanStateDir(): string {
  return path.join(os.homedir(), ".agent-runner", "digitalocean");
}

export function digitalOceanStateFile(projectSlug: string): string {
  return path.join(digitalOceanStateDir(), `${projectSlug}.json`);
}

export function readDigitalOceanStateSync(projectSlug: string): DigitalOceanState | undefined {
  const stateFile = digitalOceanStateFile(projectSlug);
  if (!fs.existsSync(stateFile)) {
    return undefined;
  }
  const raw = fs.readFileSync(stateFile, "utf8");
  return digitalOceanStateSchema.parse(JSON.parse(raw));
}

export async function readDigitalOceanState(projectSlug: string): Promise<DigitalOceanState | undefined> {
  const stateFile = digitalOceanStateFile(projectSlug);
  if (!fs.existsSync(stateFile)) {
    return undefined;
  }
  const raw = await fs.promises.readFile(stateFile, "utf8");
  return digitalOceanStateSchema.parse(JSON.parse(raw));
}

export async function writeDigitalOceanState(state: DigitalOceanState): Promise<void> {
  await fs.promises.mkdir(digitalOceanStateDir(), { recursive: true });
  await fs.promises.writeFile(
    digitalOceanStateFile(state.projectSlug),
    `${JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2)}\n`
  );
}

export function stateWithActiveDroplet(
  projectSlug: string,
  activeDroplet: ActiveDropletState,
  existing?: DigitalOceanState
): DigitalOceanState {
  return {
    version: 1,
    projectSlug,
    activeDroplet,
    updatedAt: new Date().toISOString()
  };
}

export function stateAfterDestroy(projectSlug: string): DigitalOceanState {
  return {
    version: 1,
    projectSlug,
    activeDroplet: undefined,
    updatedAt: new Date().toISOString()
  };
}
