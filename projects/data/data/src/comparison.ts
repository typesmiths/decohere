const OPERATORS = new Set(["in", "ne", "gt", "gte", "lt", "lte"]);

/** The operator and operand of a condition, or undefined for a bare value. */
function operatorOf(condition: unknown): [string, unknown] | undefined {
	if (condition === null || typeof condition !== "object" || condition instanceof Date)
		return undefined;
	const entries = Object.entries(condition);
	if (entries.length !== 1 || !OPERATORS.has(entries[0][0])) return undefined;
	return entries[0];
}

export const comparison = { operatorOf };
