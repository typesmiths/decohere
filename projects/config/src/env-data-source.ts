import { ConfigurationDataSource } from "./configuration-data-source.js";
import { ConfigurationError } from "./errors.js";
import { isTree, type Tree } from "./tree-merge.js";

const VARIABLE = /^[A-Z][A-Z0-9_]*$/;
const SEGMENT = /^[A-Z0-9]+(_[A-Z0-9]+)*$/;
/** Never config keys: as object keys they reach for what every object inherits. */
const FORBIDDEN = new Set(["constructor", "prototype"]);

function toKey(segment: string): string {
	const [first = "", ...rest] = segment.toLowerCase().split("_");
	return first + rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join("");
}

/**
 * Read `SECTION__KEY_NAME` variables as `section.keyName`, at any depth. Anything else is ignored:
 * a name must be upper-case and hold at least one `__`, so ordinary variables stay out.
 *
 * @throws {ConfigurationError} if two variables set the same key, or one sets a key inside another's
 * value: which one won would depend on their order.
 */
export function envToTree(env: Record<string, string | undefined>): Tree {
	const tree: Tree = {};
	const owners = new Map<string, string>();
	for (const [name, value] of Object.entries(env)) {
		if (value === undefined || !VARIABLE.test(name) || !name.includes("__")) continue;
		const segments = name.split("__");
		if (!segments.every((segment) => SEGMENT.test(segment))) continue;
		const keys = segments.map(toKey);
		if (keys.some((key) => FORBIDDEN.has(key))) continue;
		claim(owners, keys, name);

		let node = tree;
		for (const key of keys.slice(0, -1)) {
			const next = node[key];
			if (isTree(next)) {
				node = next;
			} else {
				const created: Tree = {};
				node[key] = created;
				node = created;
			}
		}
		node[keys.at(-1)!] = value;
	}
	return tree;
}

function claim(owners: Map<string, string>, keys: string[], name: string): void {
	const path = keys.join(".");
	const clash = [...owners].find(
		([owned]) =>
			owned === path || owned.startsWith(`${path}.`) || path.startsWith(`${owned}.`),
	);
	if (clash) {
		throw new ConfigurationError(
			`Environment variables ${clash[1]} and ${name} clash: ${clash[0]} and ${path} can't both be set`,
		);
	}
	owners.set(path, name);
}

/** Configuration from the process environment. List it last, so it overrides the files. */
export class EnvDataSource extends ConfigurationDataSource {
	public name: string = EnvDataSource.name;
	public async getData(): Promise<Record<string, unknown>> {
		return envToTree(process.env);
	}
}
