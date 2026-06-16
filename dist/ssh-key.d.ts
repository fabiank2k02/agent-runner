import { type ShellExecutor } from "./shell.js";
export interface ManagedSshKey {
    privateKeyPath: string;
    publicKeyPath: string;
    publicKey: string;
}
export declare function ensureManagedSshKey(projectSlug: string, executor: ShellExecutor): Promise<ManagedSshKey>;
