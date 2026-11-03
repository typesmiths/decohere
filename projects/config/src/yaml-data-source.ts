import { io } from "@decohere/core/io";
import { parse } from "yaml";
import { ConfigurationDataSource } from "./configuration-data-source.js";
import { DEFAULT_CONFIG_DIR } from "./const.js";
import { ConfigurationError } from "./errors.js";

const CONFIG_FILE_NAME = "config";
/** Unset NODE_ENV must not silently load config.dev.yaml (TypeORM synchronize, etc.). */
const DEFAULT_ENV = "production";
const FILE_EXT = "yaml";

/** Resolve which env-specific config file to merge (e.g. config.dev.yaml). */
export function resolveConfigEnv(nodeEnv?: string): string {
	const env = nodeEnv ?? process.env.NODE_ENV;
	if (env == null || env.trim() === "") {
		return DEFAULT_ENV;
	}
	return env;
}

export type ConfigSource = {
	/** Shown in errors, e.g. the file name. */
	name: string;
	text: string;
};

type Tree = Record<string, unknown>;
type MissingVariable = { name: string; path: string };

/** `${NAME}` or `${NAME:default}`. The default may be empty, and runs up to the first `}`. */
const PLACEHOLDER = /\$\{(\w+)(?::([^}]*))?\}/g;

function isTree(value: unknown): value is Tree {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

/** A non-empty list whose every entry is a mapping with a string `name`, such as `dataSources`. */
function isNamedList(value: unknown): value is Tree[] {
	return (
		Array.isArray(value) &&
		value.length > 0 &&
		value.every((item) => isTree(item) && typeof item.name === "string")
	);
}

/** Entries with the same name merge in place; new names are added at the end. */
function mergeNamedLists(base: Tree[], override: Tree[]): Tree[] {
	const merged = [...base];
	for (const entry of override) {
		const index = merged.findIndex((item) => item.name === entry.name);
		if (index === -1) {
			merged.push(entry);
		} else {
			merged[index] = merge(merged[index]!, entry);
		}
	}
	return merged;
}

/**
 * Objects merge key by key, and so do lists of named entries (matched by `name`), so an
 * environment file only states what it changes. Any other list, and a scalar, in the later file
 * replaces the earlier value.
 */
function merge(base: Tree, override: Tree): Tree {
	const merged: Tree = { ...base };
	for (const [key, value] of Object.entries(override)) {
		const existing = merged[key];
		if (isTree(existing) && isTree(value)) {
			merged[key] = merge(existing, value);
		} else if (isNamedList(existing) && isNamedList(value)) {
			merged[key] = mergeNamedLists(existing, value);
		} else {
			merged[key] = value;
		}
	}
	return merged;
}

/** A named list that repeats a name can't be merged by name, so say which file and where. */
function assertUniqueNames(value: unknown, source: string, path: string): void {
	if (isNamedList(value)) {
		const seen = new Set<unknown>();
		for (const item of value) {
			if (seen.has(item.name)) {
				throw new ConfigurationError(
					`Config file ${source}: ${path} lists the name "${String(item.name)}" more than once`,
				);
			}
			seen.add(item.name);
		}
	}
	if (Array.isArray(value)) {
		value.forEach((item, index) => assertUniqueNames(item, source, `${path}[${index}]`));
	} else if (isTree(value)) {
		for (const [key, item] of Object.entries(value)) {
			assertUniqueNames(item, source, path === "" ? key : `${path}.${key}`);
		}
	}
}

function resolveString(
	value: string,
	path: string,
	missing: MissingVariable[],
): string | null {
	let hasPlaceholder = false;
	const resolved = value.replace(PLACEHOLDER, (_match, name: string, fallback?: string) => {
		hasPlaceholder = true;
		const fromEnv = process.env[name];
		if (fromEnv !== undefined) {
			return fromEnv;
		}
		if (fallback !== undefined) {
			return fallback;
		}
		missing.push({ name, path });
		return "";
	});
	// A variable set to the text "null" means no value.
	return hasPlaceholder && resolved === "null" ? null : resolved;
}

function resolveValue(value: unknown, path: string, missing: MissingVariable[]): unknown {
	if (typeof value === "string") {
		return resolveString(value, path, missing);
	}
	if (Array.isArray(value)) {
		return value.map((item, index) => resolveValue(item, `${path}[${index}]`, missing));
	}
	if (isTree(value)) {
		const resolved: Tree = {};
		for (const [key, item] of Object.entries(value)) {
			resolved[key] = resolveValue(item, path === "" ? key : `${path}.${key}`, missing);
		}
		return resolved;
	}
	return value;
}

function parseSource({ name, text }: ConfigSource): Tree | undefined {
	let parsed: unknown;
	try {
		parsed = parse(text);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		throw new ConfigurationError(`Cannot parse config file ${name}: ${reason}`);
	}
	if (parsed == null) {
		return undefined;
	}
	if (!isTree(parsed)) {
		throw new ConfigurationError(
			`Config file ${name} must contain a mapping at the top level`,
		);
	}
	assertUniqueNames(parsed, name, "");
	return parsed;
}

/**
 * Merge config files in order (later files win), then resolve `${VAR}` placeholders on the
 * merged result.
 *
 * Resolving after the merge means an environment file such as `config.dev.yaml` can replace a
 * production `${VAR}` without that variable being set: a placeholder that was replaced is never
 * looked up. Placeholders still unset after the merge fail together, naming every variable and
 * the config path that used it. `${VAR:default}` keeps a default for optional values.
 */
export function resolveYamlConfig(sources: ConfigSource[]): Tree {
	let merged: Tree = {};
	for (const source of sources) {
		const tree = parseSource(source);
		if (tree !== undefined) {
			merged = merge(merged, tree);
		}
	}

	const missing: MissingVariable[] = [];
	const resolved = resolveValue(merged, "", missing) as Tree;
	if (missing.length > 0) {
		const lines = missing.map(({ name, path }) => `  - ${name} (used at ${path})`);
		throw new ConfigurationError(
			`Config references ${missing.length} environment variable(s) that are not set:\n${lines.join("\n")}\n` +
				"Set them, give the value a default with ${NAME:default}, or replace it in the environment's config file.",
		);
	}
	return resolved;
}

export class YamlDataSource extends ConfigurationDataSource {
	public name: string = YamlDataSource.name;
	public async getData(): Promise<Record<string, unknown>> {
		const configDir = process.env.CONFIG_DIR ?? DEFAULT_CONFIG_DIR;
		const env = resolveConfigEnv();
		const candidates = [
			`${configDir}/${CONFIG_FILE_NAME}.${FILE_EXT}`,
			`${configDir}/${CONFIG_FILE_NAME}.${env}.${FILE_EXT}`,
		];
		const sources: ConfigSource[] = [];
		for (const filePath of candidates) {
			if (await io.fileExists(filePath)) {
				sources.push({ name: filePath, text: await io.readFile(filePath) });
			}
		}
		return resolveYamlConfig(sources);
	}
}
