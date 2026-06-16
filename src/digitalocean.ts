const baseUrl = "https://api.digitalocean.com/v2";

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
  region: { slug: string };
  size_slug: string;
  image: { id: number; slug?: string; name: string };
  networks: {
    v4?: Array<{ ip_address: string; type: "public" | "private" | string }>;
  };
}

export class DigitalOceanApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly method: string,
    readonly path: string
  ) {
    super(message);
    this.name = "DigitalOceanApiError";
  }
}

export class DigitalOceanClient {
  constructor(private readonly options: DigitalOceanClientOptions) {}

  async listSshKeys(): Promise<DigitalOceanSshKey[]> {
    const data = await this.request<{ ssh_keys: DigitalOceanSshKey[] }>("GET", "/account/keys?per_page=200");
    return data.ssh_keys;
  }

  async createSshKey(name: string, publicKey: string): Promise<DigitalOceanSshKey> {
    const data = await this.request<{ ssh_key: DigitalOceanSshKey }>("POST", "/account/keys", {
      name,
      public_key: publicKey
    });
    return data.ssh_key;
  }

  async createDroplet(input: {
    name: string;
    region: string;
    size: string;
    image: string | number;
    sshKeys: Array<string | number>;
    tags: string[];
  }): Promise<DigitalOceanDroplet> {
    const body: Record<string, unknown> = {
      name: input.name,
      region: input.region,
      size: input.size,
      image: input.image,
      ssh_keys: input.sshKeys,
      monitoring: true
    };
    if (input.tags.length > 0) {
      body.tags = input.tags;
    }
    const data = await this.request<{ droplet: DigitalOceanDroplet }>("POST", "/droplets", body);
    return data.droplet;
  }

  async getDroplet(id: number): Promise<DigitalOceanDroplet> {
    const data = await this.request<{ droplet: DigitalOceanDroplet }>("GET", `/droplets/${id}`);
    return data.droplet;
  }

  async deleteDroplet(id: number): Promise<void> {
    await this.request<void>("DELETE", `/droplets/${id}`);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.options.token}`,
        "Content-Type": "application/json"
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    if (response.status === 204) {
      return undefined as T;
    }

    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};

    if (!response.ok) {
      const message =
        typeof parsed.message === "string"
          ? parsed.message
          : `DigitalOcean API request failed with HTTP ${response.status}`;
      throw new DigitalOceanApiError(`${method} ${path}: ${message}`, response.status, method, path);
    }

    return parsed as T;
  }
}

export function publicIpv4(droplet: DigitalOceanDroplet): string | undefined {
  return droplet.networks.v4?.find((network) => network.type === "public")?.ip_address;
}

export function isDigitalOceanNotFound(error: unknown): boolean {
  return error instanceof DigitalOceanApiError && error.status === 404;
}
