import { readFileSync } from "node:fs";
import { CREATE_VERSION } from "../version.js";
import {
	DEFAULT_WEBAPI_NAME,
	webapiPackageName,
	webapiPort,
	webapiReleaseEntry,
} from "../webapi/const.js";
import { WELL_KNOWN_FILES } from "./const.js";
import type { KeyedModel, SourceFile } from "./source-file.js";

/** Exact, so a new version of a tool can't make a new project fail its own lint check. */
export const OXLINT_VERSION = "1.87.0";
export const PRETTIER_VERSION = "3.9.10";

export type PackageJsonOptions = {
	startEntry?: string;
	/** API slugs in this workspace. Drives `start:<name>` / `dev:<name>`. */
	apiNames?: readonly string[];
	/** Host workspace name used in `@<workspace>/<api>` for flux `--project`. */
	workspaceName?: string;
};

/**
 * Builder for the root `package.json`.
 *
 * Starts with the core API dependencies. Features call `addDependency` /
 * `addDevDependency` during their scaffold phase to inject their own deps
 * before `files()` is called at render time.
 */
export class PackageJson implements KeyedModel {
	public readonly key = WELL_KNOWN_FILES.PACKAGE_JSON;

	private _dependencies: Record<string, string>;
	private _devDependencies: Record<string, string>;
	private _scripts: Record<string, string>;
	private _version = "0.0.1";
	private _type = "module";
	private _rest: Record<string, unknown> = {};

	public constructor(
		private readonly name: string,
		options?: PackageJsonOptions,
	) {
		const apiNames = options?.apiNames ?? [DEFAULT_WEBAPI_NAME];
		const first = apiNames[0] ?? DEFAULT_WEBAPI_NAME;
		const startEntry = options?.startEntry ?? webapiReleaseEntry(first);
		const workspaceName = options?.workspaceName ?? stripApiSuffix(name);
		const namedOrMany = apiNames.length > 1 || first !== DEFAULT_WEBAPI_NAME;

		this._scripts = {
			build: "forge build --configuration release",
			"build:watch": "forge build --watch",
			// Release build, then `.package/` in every API (what its Dockerfile copies).
			package: "pnpm run build && forge package",
			start: `node ${startEntry}`,
			dev: namedOrMany
				? fluxDevScript(workspaceName, first, webapiPort(0))
				: "flux serve --env-file-if-exists .env",
			// Prettier reads a folder before ignoring it, and Postgres's data folder isn't readable by everyone.
			lint: 'oxlint --fix && prettier --write . "!.devcontainer/**"',
			"lint:check": 'oxlint --deny-warnings && prettier --check . "!.devcontainer/**"',
			typecheck: "forge typecheck",
			test: "vitest run --passWithNoTests",
		};
		for (const [index, apiName] of apiNames.entries()) {
			this._scripts[`start:${apiName}`] = `node ${webapiReleaseEntry(apiName)}`;
			this._scripts[`package:${apiName}`] = packageScript(workspaceName, apiName);
			this._scripts[`dev:${apiName}`] = fluxDevScript(
				workspaceName,
				apiName,
				webapiPort(index),
			);
		}
		this._dependencies = {
			"@decohere/http": CREATE_VERSION,
			"@decohere/crucible": CREATE_VERSION,
			"@decohere/core": CREATE_VERSION,
			"@decohere/config": CREATE_VERSION,
			"@decohere/scribe": CREATE_VERSION,
			"@decohere/scribe-pino": CREATE_VERSION,
			"pino-pretty": "^13.0.0",
			"pino-roll": "^4.0.0",
		};
		this._devDependencies = {
			"@decohere/forge": CREATE_VERSION,
			"@decohere/cli": CREATE_VERSION,
			"@types/node": "^24.0.0",
			typescript: "^6.0.3",
			oxlint: OXLINT_VERSION,
			prettier: PRETTIER_VERSION,
			vitest: "^4.1.12",
		};
	}

	/** Load an existing root package.json so `webapi add` can merge scripts/deps. */
	public static fromFile(filePath: string): PackageJson {
		const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
		const pkg = new PackageJson(typeof raw.name === "string" ? raw.name : "app", {
			apiNames: [],
		});
		pkg._version = typeof raw.version === "string" ? raw.version : "0.0.1";
		pkg._type = typeof raw.type === "string" ? raw.type : "module";
		pkg._scripts = { ...asStringMap(raw.scripts) };
		pkg._dependencies = { ...asStringMap(raw.dependencies) };
		pkg._devDependencies = { ...asStringMap(raw.devDependencies) };
		const reserved = new Set([
			"name",
			"version",
			"type",
			"scripts",
			"dependencies",
			"devDependencies",
		]);
		pkg._rest = Object.fromEntries(Object.entries(raw).filter(([key]) => !reserved.has(key)));
		return pkg;
	}

	public addDependency(name: string, version: string): this {
		this._dependencies[name] = version;
		return this;
	}

	public addDevDependency(name: string, version: string): this {
		this._devDependencies[name] = version;
		return this;
	}

	public addScript(name: string, command: string): this {
		this._scripts[name] = command;
		return this;
	}

	public hasScript(name: string): boolean {
		return typeof this._scripts[name] === "string";
	}

	public files(): SourceFile[] {
		return [
			{
				filePath: "package.json",
				content: JSON.stringify(
					{
						name: this.name,
						version: this._version,
						type: this._type,
						...this._rest,
						scripts: this._scripts,
						dependencies: sortStringMap(this._dependencies),
						devDependencies: sortStringMap(this._devDependencies),
					},
					null,
					2,
				),
			},
		];
	}
}

function stripApiSuffix(name: string): string {
	return name.endsWith(".api") ? name.slice(0, -".api".length) : name;
}

function asStringMap(value: unknown): Record<string, string> {
	if (value == null || typeof value !== "object") return {};
	const result: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry === "string") result[key] = entry;
	}
	return result;
}

/** Stable A→Z key order for package.json dependency maps. */
export function sortStringMap(map: Record<string, string>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(map).sort(([left], [right]) => left.localeCompare(right, "en")),
	);
}

export function packageScript(workspaceName: string, apiName: string): string {
	return `pnpm run build && forge package ${webapiPackageName(workspaceName, apiName)}`;
}

function fluxDevScript(workspaceName: string, apiName: string, port: number): string {
	return `PORT=${port} flux serve --env-file-if-exists .env --project ${webapiPackageName(workspaceName, apiName)}`;
}
