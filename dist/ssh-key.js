import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { requireSuccess } from "./shell.js";
export async function ensureManagedSshKey(projectSlug, executor) {
    const keyDir = path.join(os.homedir(), ".agent-runner", "keys");
    const privateKeyPath = path.join(keyDir, `${projectSlug}_ed25519`);
    const publicKeyPath = `${privateKeyPath}.pub`;
    await fs.promises.mkdir(keyDir, { recursive: true });
    if (!fs.existsSync(privateKeyPath) || !fs.existsSync(publicKeyPath)) {
        await requireSuccess(executor.run("ssh-keygen", [
            "-t",
            "ed25519",
            "-N",
            "",
            "-C",
            `agent-runner-${projectSlug}`,
            "-f",
            privateKeyPath
        ]), "Failed to generate managed SSH key");
    }
    await fs.promises.chmod(privateKeyPath, 0o600);
    const publicKey = (await fs.promises.readFile(publicKeyPath, "utf8")).trim();
    return { privateKeyPath, publicKeyPath, publicKey };
}
//# sourceMappingURL=ssh-key.js.map