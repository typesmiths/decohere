import { ConfigurationDataSource } from "./configuration-data-source.js";
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
 */
export function envToTree(env: Record<string, string | undefined>): Tree {
	const tree: Tree = {};
	for (const [name, value] of Object.entries(env)) {
		if (value === undefined || !VARIABLE.test(name) || !name.includes("__")) continue;
		const segments = name.split("__");
		if (!segments.every((segment) => SEGMENT.test(segment))) continue;
		const keys = segments.map(toKey);
		if (keys.some((key) => FORBIDDEN.has(key))) continue;

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

/** Configuration from the process environment. List it last, so it overrides the files. */
export class EnvDataSource extends ConfigurationDataSource {
	public name: string = EnvDataSource.name;
	public async getData(): Promise<Record<string, unknown>> {
		return envToTree(process.env);
	}
}
