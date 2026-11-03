import { DefaultCensor, DefaultRedactions, type RedactionOptions } from "./types.js";

function keysFromPaths(paths: string[]): Set<string> {
	const keys = new Set<string>();
	for (const path of paths) {
		const segments = path
			.split(".")
			.filter((segment) => segment.length > 0 && segment !== "*");
		const key = segments.at(-1);
		if (key != null) {
			keys.add(key);
		}
	}
	return keys;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (
		value == null ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		value instanceof Error
	) {
		return false;
	}
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

function object(
	value: unknown,
	keys: ReadonlySet<string>,
	censor: string = DefaultCensor,
	copies: WeakMap<object, unknown> = new WeakMap(),
): unknown {
	if (value == null || typeof value !== "object") {
		return value;
	}
	if (value instanceof Error) {
		return value;
	}
	// A cycle in the input stays a cycle in the copy.
	const copied = copies.get(value);
	if (copied !== undefined) {
		return copied;
	}
	if (Array.isArray(value)) {
		const out: unknown[] = [];
		copies.set(value, out);
		for (const item of value) {
			out.push(object(item, keys, censor, copies));
		}
		return out;
	}
	if (!isPlainObject(value)) {
		return value;
	}
	const out: Record<string, unknown> = {};
	copies.set(value, out);
	for (const [key, nested] of Object.entries(value)) {
		out[key] = keys.has(key) ? censor : object(nested, keys, censor, copies);
	}
	return out;
}

function fromOptions(options?: RedactionOptions): Set<string> {
	return keysFromPaths(options?.paths ?? DefaultRedactions.paths);
}

export const redact = { object, keysFromPaths, fromOptions };
