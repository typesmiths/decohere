import { readFileSync } from "node:fs";
import { type Document, isMap, isSeq, parseDocument } from "yaml";
import { WELL_KNOWN_FILES } from "./const.js";
import type { KeyedModel } from "./source-file.js";

export type ComposeNetworkRef =
	| string
	| {
			/** Network key under `networks:` on this service */
			[networkKey: string]: { aliases?: string[] };
	  };

export interface ComposeHealthcheck {
	test: string[];
	interval?: string;
	timeout?: string;
	retries?: number;
}

export interface ComposeService {
	build?: string;
	image?: string;
	container_name?: string;
	/** Quoted in YAML (`0:0` must not parse as a number). */
	user?: string;
	env_file?: string[];
	environment?: Record<string, string>;
	ports?: string[];
	volumes?: string[];
	command?: string;
	restart?: string;
	depends_on?: string[];
	/** Compose profiles (service only starts when profile is enabled). */
	profiles?: string[];
	/** Attach to compose networks (string name or map with aliases). */
	networks?: ComposeNetworkRef[];
	healthcheck?: ComposeHealthcheck;
}

export type ComposeNetwork = {
	/** Fixed Docker network name (shareable across compose projects). */
	name: string;
	external?: boolean;
};

/**
 * Live builder for `docker-compose.yml`.
 *
 * Features call `addService` / `addVolume` / `addNetwork` in their scaffold phases.
 * Loaded with `fromFile` (`decohere add api`), additions merge into the existing file:
 * services, networks and volumes already there are left untouched, comments kept.
 */
export class DockerCompose implements KeyedModel {
	public readonly key = WELL_KNOWN_FILES.DOCKER_COMPOSE;
	private _projectName: string | undefined;
	private readonly _headerComments: string[] = [];
	private readonly _services: Map<string, ComposeService> = new Map();
	private readonly _volumes: Set<string> = new Set();
	private readonly _networks: Map<string, ComposeNetwork> = new Map();
	private readonly _envFiles: Array<[service: string, path: string]> = [];
	private _existing: Document | undefined;

	/** Load an existing compose file so `decohere add api` can merge into it. */
	public static fromFile(absolutePath: string): DockerCompose {
		const compose = new DockerCompose();
		compose._existing = parseDocument(readFileSync(absolutePath, "utf8"));
		return compose;
	}

	/** True when the service is defined (in the loaded file or added since). */
	public hasService(name: string): boolean {
		return this._services.has(name) || this._existing?.hasIn(["services", name]) === true;
	}

	/** Compose project name (`name:` top-level) — isolates containers/volumes. */
	public setProjectName(name: string): this {
		this._projectName = name;
		return this;
	}

	/** File-level `#` comments rendered above `name:` / `services:`. */
	public addHeaderComment(...lines: string[]): this {
		this._headerComments.push(...lines);
		return this;
	}

	public addService(name: string, config: ComposeService): this {
		this._services.set(name, config);
		return this;
	}

	public files() {
		return [
			{
				filePath: ".devcontainer/docker-compose.yml",
				content: this.getContent(),
			},
		];
	}

	public addVolume(name: string): this {
		this._volumes.add(name);
		return this;
	}

	public addNetwork(key: string, network: ComposeNetwork): this {
		this._networks.set(key, network);
		return this;
	}

	/** Append an env_file path to an existing service. */
	public addEnvFile(serviceName: string, filePath: string): this {
		// A service already in the loaded file wins over an `addService` of the same name.
		const svc = this._existing?.hasIn(["services", serviceName])
			? undefined
			: this._services.get(serviceName);
		if (svc) svc.env_file = [...(svc.env_file ?? []), filePath];
		else this._envFiles.push([serviceName, filePath]);
		return this;
	}

	public getContent(): string {
		if (this._existing) return this.mergeIntoExisting(this._existing);
		const lines: string[] = [];
		for (const comment of this._headerComments) {
			lines.push(comment.startsWith("#") ? comment : `# ${comment}`);
		}
		if (this._headerComments.length > 0) {
			lines.push("");
		}
		if (this._projectName) {
			lines.push(`name: ${this._projectName}`, "");
		}
		lines.push("services:");

		for (const [name, svc] of this._services) {
			lines.push(`  ${name}:`);
			if (svc.build) lines.push(`    build: ${svc.build}`);
			if (svc.image) lines.push(`    image: ${svc.image}`);
			if (svc.container_name) lines.push(`    container_name: ${svc.container_name}`);
			if (svc.command) lines.push(`    command: ${svc.command}`);
			if (svc.user) lines.push(`    user: "${svc.user}"`);
			if (svc.restart) lines.push(`    restart: ${svc.restart}`);

			if (svc.profiles && svc.profiles.length > 0) {
				lines.push("    profiles:");
				for (const p of svc.profiles) lines.push(`      - ${p}`);
			}

			if (svc.env_file && svc.env_file.length > 0) {
				lines.push("    env_file:");
				for (const f of svc.env_file) lines.push(`      - ${f}`);
			}

			if (svc.environment && Object.keys(svc.environment).length > 0) {
				lines.push("    environment:");
				for (const [k, v] of Object.entries(svc.environment)) {
					lines.push(`      ${k}: ${v}`);
				}
			}

			if (svc.ports && svc.ports.length > 0) {
				lines.push("    ports:");
				for (const p of svc.ports) lines.push(`      - "${p}"`);
			}

			if (svc.volumes && svc.volumes.length > 0) {
				lines.push("    volumes:");
				for (const v of svc.volumes) lines.push(`      - ${v}`);
			}

			if (svc.networks && svc.networks.length > 0) {
				const onlyStrings = svc.networks.every((n) => typeof n === "string");
				if (onlyStrings) {
					lines.push("    networks:");
					for (const n of svc.networks) lines.push(`      - ${n as string}`);
				} else {
					lines.push("    networks:");
					for (const n of svc.networks) {
						if (typeof n === "string") {
							lines.push(`      ${n}:`);
						} else {
							for (const [netKey, cfg] of Object.entries(n)) {
								lines.push(`      ${netKey}:`);
								if (cfg.aliases && cfg.aliases.length > 0) {
									lines.push("        aliases:");
									for (const a of cfg.aliases) lines.push(`          - ${a}`);
								}
							}
						}
					}
				}
			}

			if (svc.depends_on && svc.depends_on.length > 0) {
				lines.push("    depends_on:");
				for (const d of svc.depends_on) lines.push(`      - ${d}`);
			}

			if (svc.healthcheck) {
				const hc = svc.healthcheck;
				lines.push("    healthcheck:");
				lines.push(`      test: ${JSON.stringify(hc.test)}`);
				if (hc.interval) lines.push(`      interval: ${hc.interval}`);
				if (hc.timeout) lines.push(`      timeout: ${hc.timeout}`);
				if (hc.retries != null) lines.push(`      retries: ${hc.retries}`);
			}
		}

		if (this._networks.size > 0) {
			lines.push("");
			lines.push("networks:");
			for (const [key, net] of this._networks) {
				lines.push(`  ${key}:`);
				lines.push(`    name: ${net.name}`);
				if (net.external) lines.push("    external: true");
			}
		}

		if (this._volumes.size > 0) {
			lines.push("");
			lines.push("volumes:");
			for (const v of this._volumes) lines.push(`  ${v}:`);
		}

		return `${lines.join("\n")}\n`;
	}

	private mergeIntoExisting(doc: Document): string {
		if (!isMap(doc.contents)) throw new Error("docker-compose.yml is not a YAML mapping");
		for (const line of this._headerComments) {
			const text = line.replace(/^#\s?/, "");
			const before = doc.commentBefore ?? "";
			if (!before.includes(text))
				doc.commentBefore = before ? `${before}\n ${text}` : ` ${text}`;
		}
		for (const [name, svc] of this._services) {
			if (!doc.hasIn(["services", name]))
				doc.setIn(["services", name], doc.createNode(toComposeYaml(svc)));
		}
		for (const [service, path] of this._envFiles) {
			if (!doc.hasIn(["services", service])) continue;
			const envFiles = doc.getIn(["services", service, "env_file"]);
			if (isSeq(envFiles)) {
				if (!envFiles.items.some((item) => String(item) === path)) envFiles.add(path);
			} else if (envFiles == null) {
				doc.setIn(["services", service, "env_file"], doc.createNode([path]));
			} else if (String(envFiles) !== path) {
				doc.setIn(["services", service, "env_file"], doc.createNode([String(envFiles), path]));
			}
		}
		for (const [key, network] of this._networks) {
			if (!doc.hasIn(["networks", key])) doc.setIn(["networks", key], doc.createNode(network));
		}
		for (const volume of this._volumes) {
			if (!doc.hasIn(["volumes", volume])) doc.setIn(["volumes", volume], null);
		}
		return doc.toString({ lineWidth: 0 });
	}
}

/** Plain compose YAML shape for a service (networks with aliases become a map). */
function toComposeYaml(svc: ComposeService): Record<string, unknown> {
	const { networks, ...rest } = svc;
	if (!networks || networks.length === 0) return rest;
	if (networks.every((n) => typeof n === "string")) return { ...rest, networks };
	const networkMap: Record<string, { aliases?: string[] } | null> = {};
	for (const network of networks) {
		if (typeof network === "string") networkMap[network] = null;
		else Object.assign(networkMap, network);
	}
	return { ...rest, networks: networkMap };
}
