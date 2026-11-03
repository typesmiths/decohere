export function mergeByKey<T>(first: T[], second: T[], key: keyof T): T[] {
	return mergeBy(first, second, (item) => String(item[key]));
}

export function mergeBy<T>(first: T[], second: T[], selector: (item: T) => string): T[] {
	// Second collection values win when keys collide.
	const merged = [...first, ...second];
	return [...new Map(merged.map((item) => [selector(item), item])).values()];
}
