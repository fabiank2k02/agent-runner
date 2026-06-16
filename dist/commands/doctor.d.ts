import type { CommandContext } from "../context.js";
export interface DoctorCheck {
    name: string;
    ok: boolean;
    detail: string;
}
export interface DoctorResult {
    ok: boolean;
    checks: DoctorCheck[];
}
export declare function doctor(context: CommandContext): Promise<DoctorResult>;
