const baseUrl = "https://api.digitalocean.com/v2";
export class DigitalOceanApiError extends Error {
    status;
    method;
    path;
    constructor(message, status, method, path) {
        super(message);
        this.status = status;
        this.method = method;
        this.path = path;
        this.name = "DigitalOceanApiError";
    }
}
export class DigitalOceanClient {
    options;
    constructor(options) {
        this.options = options;
    }
    async listSshKeys() {
        const data = await this.request("GET", "/account/keys?per_page=200");
        return data.ssh_keys;
    }
    async listSizes() {
        const data = await this.request("GET", "/sizes?per_page=200");
        return data.sizes;
    }
    async getSize(slug) {
        const sizes = await this.listSizes();
        return sizes.find((size) => size.slug === slug);
    }
    async createSshKey(name, publicKey) {
        const data = await this.request("POST", "/account/keys", {
            name,
            public_key: publicKey
        });
        return data.ssh_key;
    }
    async createDroplet(input) {
        const body = {
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
        const data = await this.request("POST", "/droplets", body);
        return data.droplet;
    }
    async getDroplet(id) {
        const data = await this.request("GET", `/droplets/${id}`);
        return data.droplet;
    }
    async deleteDroplet(id) {
        await this.request("DELETE", `/droplets/${id}`);
    }
    async request(method, path, body) {
        const response = await fetch(`${baseUrl}${path}`, {
            method,
            headers: {
                Authorization: `Bearer ${this.options.token}`,
                "Content-Type": "application/json"
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        if (response.status === 204) {
            return undefined;
        }
        const text = await response.text();
        const parsed = text ? JSON.parse(text) : {};
        if (!response.ok) {
            const message = typeof parsed.message === "string"
                ? parsed.message
                : `DigitalOcean API request failed with HTTP ${response.status}`;
            throw new DigitalOceanApiError(`${method} ${path}: ${message}`, response.status, method, path);
        }
        return parsed;
    }
}
export function publicIpv4(droplet) {
    return droplet.networks.v4?.find((network) => network.type === "public")?.ip_address;
}
export function isDigitalOceanNotFound(error) {
    return error instanceof DigitalOceanApiError && error.status === 404;
}
//# sourceMappingURL=digitalocean.js.map