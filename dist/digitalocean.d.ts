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
export declare class DigitalOceanClient {
    private readonly options;
    constructor(options: DigitalOceanClientOptions);
    listSshKeys(): Promise<DigitalOceanSshKey[]>;
    createSshKey(name: string, publicKey: string): Promise<DigitalOceanSshKey>;
    createDroplet(input: {
        name: string;
        region: string;
        size: string;
        image: string | number;
        sshKeys: Array<string | number>;
        tags: string[];
    }): Promise<DigitalOceanDroplet>;
    getDroplet(id: number): Promise<DigitalOceanDroplet>;
    deleteDroplet(id: number): Promise<void>;
    private request;
}
export declare function publicIpv4(droplet: DigitalOceanDroplet): string | undefined;
