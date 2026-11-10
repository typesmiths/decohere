import { isDeepStrictEqual } from "node:util";
import { posix } from "node:path";
import { isMap, isScalar, isSeq, type Node, parseDocument } from "yaml";

/**
 * Merging a template file into one the workspace already has. Each merge only adds: what the
 * file has stays as it is, so running a step again changes nothing. Returns `undefined` when a
 * file can't be merged, such as source code that is no longer what a template wrote.
 */

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function isObject(value: Json | undefined): value is { [key: string]: Json } {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

/** Adds what `from` has and `into` doesn't. Returns true if it added anything. */
function addJson(into: Json, from: Json): boolean {
	if (isObject(into) && isObject(from)) {
		let added = false;
		for (const [key, value] of Object.entries(from)) {
			const existing = into[key];
			if (existing === undefined) {
				into[key] = value;
				added = true;
			} else if (addJson(existing, value)) {
				added = true;
			}
		}
		return added;
	}
	if (Array.isArray(into) && Array.isArray(from)) {
		const missing = from.filter((item) => !into.some((have) => isDeepStrictEqual(have, item)));
		into.push(...missing);
		return missing.length > 0;
	}
	return false;
}

function sortKeys(map: Json | undefined): Json | undefined {
	if (!isObject(map)) return map;
	return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b, "en")));
}

function json(existing: string, incoming: string, path: string): string | undefined {
	let into: Json;
	try {
		into = JSON.parse(existing) as Json;
	} catch {
		// Not plain JSON (comments, a typo): the user adds it by hand.
		return undefined;
	}
	if (!addJson(into, JSON.parse(incoming) as Json)) return existing;
	if (posix.basename(path) === "package.json" && isObject(into)) {
		for (const key of ["dependencies", "devDependencies"]) {
			if (into[key] !== undefined) into[key] = sortKeys(into[key]) ?? null;
		}
	}
	return `${JSON.stringify(into, null, 2)}\n`;
}

function nameOf(node: unknown): unknown {
	return isMap(node) ? node.get("name") : undefined;
}

/** Adds what `from` has and `into` doesn't; list items with a `name` match by it. */
function addYaml(into: Node, from: Node): boolean {
	if (isMap(into) && isMap(from)) {
		let added = false;
		for (const pair of from.items) {
			const key = isScalar(pair.key) ? pair.key.value : pair.key;
			const existing = into.items.find(
				(item) => (isScalar(item.key) ? item.key.value : item.key) === key,
			);
			if (existing == null) {
				into.items.push(pair);
				added = true;
			} else if (addYaml(existing.value as Node, pair.value as Node)) {
				added = true;
			}
		}
		return added;
	}
	if (isSeq(into) && isSeq(from)) {
		let added = false;
		for (const item of from.items) {
			const name = nameOf(item);
			const present = into.items.some((have) =>
				name !== undefined
					? nameOf(have) === name
					: isDeepStrictEqual((have as Node).toJSON(), (item as Node).toJSON()),
			);
			if (!present) {
				into.items.push(item);
				added = true;
			}
		}
		return added;
	}
	return false;
}

function yaml(existing: string, incoming: string): string | undefined {
	const into = parseDocument(existing);
	const from = parseDocument(incoming);
	if (into.errors.length > 0) return undefined;
	if (from.contents == null) return existing;
	if (into.contents == null) {
		into.contents = from.contents;
		if (from.commentBefore != null) {
			into.commentBefore = [into.commentBefore, from.commentBefore].filter(Boolean).join("\n");
		}
		return into.toString();
	}
	return addYaml(into.contents, from.contents) ? into.toString() : existing;
}

/** One entry per line, such as `.gitignore`: adds the lines it doesn't have. */
function lines(existing: string, incoming: string): string {
	const have = new Set(existing.split("\n").map((line) => line.trim()));
	const missing = incoming
		.split("\n")
		.filter((line) => line.trim() !== "" && !have.has(line.trim()));
	if (missing.length === 0) return existing;
	const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
	return `${existing}${separator}${missing.join("\n")}\n`;
}

/** `.env`: adds the variables it doesn't set, and never changes a value it has. */
function env(existing: string, incoming: string): string {
	const keyOf = (line: string) => line.slice(0, line.indexOf("=")).trim();
	const have = new Set(
		existing
			.split("\n")
			.filter((line) => line.includes("="))
			.map(keyOf),
	);
	const missing = incoming
		.split("\n")
		.filter((line) => line.includes("=") && !have.has(keyOf(line)))
		.join("\n");
	return missing === "" ? existing : lines(existing, missing);
}

/** Markdown: adds each `## ` section whose heading it doesn't have. */
function markdown(existing: string, incoming: string): string {
	const sections = incoming.split(/\n(?=## )/);
	const missing = sections.filter((section) => {
		const heading = section.split("\n")[0]?.trim() ?? "";
		return !existing.split("\n").some((line) => line.trim() === heading);
	});
	if (missing.length === 0) return existing;
	return `${existing.trimEnd()}\n\n${missing.map((section) => section.trim()).join("\n\n")}\n`;
}

/** A Dockerfile: adds the steps it doesn't have, before it hands back to the last USER. */
function dockerfile(existing: string, incoming: string): string {
	const block = incoming.trim();
	if (existing.includes(block)) return existing;
	const lastUser = [...existing.matchAll(/^USER .*$/gm)].at(-1);
	if (lastUser == null) return `${existing.trimEnd()}\n\n${block}\n`;
	return `${existing.slice(0, lastUser.index)}${block}\n\n${existing.slice(lastUser.index)}`;
}

const LINE_FILES = new Set([".gitignore", ".prettierignore", ".dockerignore"]);

/** `existing` with what `incoming` adds, or `undefined` if the file can't be merged. */
function file(path: string, existing: string, incoming: string): string | undefined {
	if (existing === incoming) return existing;
	const name = posix.basename(path);
	if (name.endsWith(".json")) return json(existing, incoming, path);
	if (name.endsWith(".yaml") || name.endsWith(".yml")) return yaml(existing, incoming);
	if (name.endsWith(".md")) return markdown(existing, incoming);
	if (name === ".env") return env(existing, incoming);
	if (LINE_FILES.has(name)) return lines(existing, incoming);
	if (path === ".devcontainer/Dockerfile") return dockerfile(existing, incoming);
	return undefined;
}

export const merge = { file, json };
