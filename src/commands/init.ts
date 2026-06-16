import fs from "node:fs";
import { createDefaultConfig, configFileName } from "../config.js";

export interface InitResult {
  path: string;
  created: boolean;
}

export async function initProject(projectRoot: string, options: { force?: boolean } = {}): Promise<InitResult> {
  const configPath = `${projectRoot}/${configFileName}`;
  if (fs.existsSync(configPath) && !options.force) {
    return { path: configPath, created: false };
  }

  const config = createDefaultConfig(projectRoot);
  await fs.promises.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  return { path: configPath, created: true };
}
