export function uniqueObjectsByKey<T>(objects: T[], key: keyof T): T[] {
	return uniqueObjects(objects, key);
}

export function uniqueObjectsBy<T>(objects: T[], key: (obj: T) => string): T[] {
	return uniqueObjects(objects, key);
}

function uniqueObjects<T>(objects: T[], key: (obj: T) => string);
function uniqueObjects<T>(objects: T[], key: keyof T);
function uniqueObjects<T>(objects: T[], key: keyof T | ((obj: T) => string)) {
	const getKey = (key: keyof T | ((obj: T) => string), item: T) => {
		if (typeof key === "function") {
			return key(item);
		}

		return item != null ? item[key] : null;
	};
	const arrayUniqueByKey = [
		...new Map(objects.map((item) => [getKey(key, item), item])).values(),
	];
	return arrayUniqueByKey;
}
