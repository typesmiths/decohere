export type Tree = Record<string, unknown>;

export function isTree(value: unknown): value is Tree {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

/** A non-empty list whose every entry is a mapping with a string `name`, such as `dataSources`. */
export function isNamedList(value: unknown): value is Tree[] {
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
			merged[index] = mergeTrees(merged[index]!, entry);
		}
	}
	return merged;
}

/**
 * Objects merge key by key, and so do lists of named entries (matched by `name`), so a later layer
 * only states what it changes. Any other list, and a scalar, in the later layer replaces the
 * earlier value.
 */
export function mergeTrees(base: Tree, override: Tree): Tree {
	const merged: Tree = { ...base };
	for (const [key, value] of Object.entries(override)) {
		const existing = merged[key];
		if (isTree(existing) && isTree(value)) {
			merged[key] = mergeTrees(existing, value);
		} else if (isNamedList(existing) && isNamedList(value)) {
			merged[key] = mergeNamedLists(existing, value);
		} else {
			merged[key] = value;
		}
	}
	return merged;
}
