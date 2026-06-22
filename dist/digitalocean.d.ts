export interface DigitalOceanClientOptions {
    token: string;
}
export interface DigitalOceanSshKey {
    id: number;
    name: string;
    public_key: string;
    fingerprint: string;
}
export interface DigitalOceanDroplet {
    id: number;
    name: string;
    status: "new" | "active" | "off" | "archive" | string;
    locked: boolean;
    region: {
        slug: string;
    };
    size_slug: string;
    image: {
        id: number;
        slug?: string;
        name: string;
    };
    networks: {
        v4?: Array<{
            ip_address: string;
            type: "public" | "private" | string;
        }>;
    };
}
export interface DigitalOceanSnapshot {
    id: string | number;
    name: string;
    resource_id: string | number;
    resource_type: "droplet" | "volume" | string;
    min_disk_size: number;
    size_gigabytes: number;
    created_at: string;
    regions: string[];
    tags?: string[];
}
export interface DigitalOceanSize {
    slug: string;
    price_monthly: number;
    price_hourly: number;
}
export interface DigitalOceanAction {
    id: number;
    status: "in-progress" | "completed" | "errored" | string;
    type: string;
    started_at?: string;
    completed_at?: string | null;
    resource_id?: string | number | null;
    resource_type?: string | null;
    region?: {
        slug: string;
    } | null;
}
export declare class DigitalOceanApiError extends Error {
    readonly status: number;
    readonly method: string;
    readonly path: string;
    constructor(message: string, status: number, method: string, path: string);
}
export declare class DigitalOceanClient {
    private readonly options;
    constructor(options: DigitalOceanClientOptions);
    listSshKeys(): Promise<DigitalOceanSshKey[]>;
    listSizes(): Promise<DigitalOceanSize[]>;
    getSize(slug: string): Promise<DigitalOceanSize | undefined>;
    createSshKey(name: string, publicKey: string): Promise<DigitalOceanSshKey>;
    createDroplet(input: {
        name: string;
        region: string;
        size: string;
        image: string | number;
        sshKeys: Array<string | number>;
        tags: string[];
    }): Promise<DigitalOceanDroplet>;
    listDropletSnapshots(): Promise<DigitalOceanSnapshot[]>;
    createDropletSnapshot(dropletId: number, name: string): Promise<DigitalOceanAction>;
    getDropletAction(dropletId: number, actionId: number): Promise<DigitalOceanAction>;
    getDroplet(id: number): Promise<DigitalOceanDroplet>;
    deleteDroplet(id: number): Promise<void>;
    deleteSnapshot(id: string | number): Promise<void>;
    private request;
}
export declare function publicIpv4(droplet: DigitalOceanDroplet): string | undefined;
export declare function isDigitalOceanNotFound(error: unknown): boolean;
