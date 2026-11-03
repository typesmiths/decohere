export function sumByKey<T>(objects: T[], key: keyof T): number;
export function sumByKey<T>(objects: T[], key: keyof T): bigint;
export function sumByKey<T>(objects: T[], key: keyof T): number | bigint {
	return sum(objects, key);
}

export function sumBy<T>(objects: T[], key: (obj: T) => number): number;
export function sumBy<T>(objects: T[], key: (obj: T) => bigint): bigint;
export function sumBy<T>(objects: T[], key: (obj: T) => number | bigint): number | bigint {
	return sum(objects, key);
}

function extractValueFromItem<T>(
	item: T,
	key: keyof T | ((obj: T) => number | bigint),
): number | bigint {
	if (typeof key === "function") {
		const result = key(item);
		return isNumericValue(result) ? result : 0;
	}

	const value = item?.[key];
	return isNumericValue(value) ? value : 0;
}

function isNumericValue(value: unknown): value is number | bigint {
	return typeof value === "number" || typeof value === "bigint";
}

function determineSumType(firstValue: number | bigint): "bigint" | "number" {
	return typeof firstValue === "bigint" ? "bigint" : "number";
}

function getInitialSumValue(sumType: "bigint" | "number"): number | bigint {
	return sumType === "bigint" ? 0n : 0;
}

function addValues(
	total: number | bigint,
	value: number | bigint,
	sumType: "bigint" | "number",
): number | bigint {
	if (sumType === "bigint") {
		const totalBigInt = total as bigint;
		const valueBigInt = typeof value === "bigint" ? value : BigInt(value);
		return totalBigInt + valueBigInt;
	}

	const totalNumber = total as number;
	const valueNumber = typeof value === "number" ? value : Number(value);
	return totalNumber + valueNumber;
}

function sum<T>(objects: T[], key: (obj: T) => number): number;
function sum<T>(objects: T[], key: (obj: T) => bigint): bigint;
function sum<T>(objects: T[], key: (obj: T) => number | bigint): number | bigint;
function sum<T>(objects: T[], key: keyof T): number | bigint;
function sum<T>(objects: T[], key: keyof T | ((obj: T) => number | bigint)): number | bigint {
	if (objects.length === 0) {
		return 0;
	}

	const firstValue = extractValueFromItem(objects[0], key);
	const sumType = determineSumType(firstValue);
	const initialValue = getInitialSumValue(sumType);

	return objects.reduce((total, item) => {
		const value = extractValueFromItem(item, key);
		return addValues(total, value, sumType);
	}, initialValue);
}
