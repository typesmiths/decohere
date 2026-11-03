export function findDuplicatesByKey<T>(items: T[], key: keyof T): [string, T[]][] {
	return findDuplicatesBy(items, (item) => String(item[key]));
}

export function findDuplicatesBy<T>(
	items: T[],
	selector: (item: T) => string,
): [string, T[]][] {
	const groups = new Map<string, T[]>();
	for (const item of items) {
		const k = selector(item);
		const existing = groups.get(k) ?? [];
		groups.set(k, [...existing, item]);
	}
	return [...groups.entries()].filter(([, group]) => group.length > 1);
}
