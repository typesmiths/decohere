import type { Type } from "@decohere/core/reflection";
import { isDateType } from "@decohere/core/reflection";
import { TransformError, ValidationError } from "../http.types.js";

export type PipeContext = {
	fieldTypes: Record<string, Type>;
};

const invalidBooleanIssue = {
	path: "/value",
	message: "Invalid boolean",
	keyword: "type",
} as const;

const invalidNumberIssue = {
	path: "/value",
	message: "Invalid number",
	keyword: "type",
} as const;

const invalidDateIssue = {
	path: "/value",
	message: "Invalid date",
	keyword: "format",
} as const;

export abstract class Pipe<T = unknown> {
	public abstract transform(value: unknown, context?: PipeContext): T;
}

export class BooleanPipe extends Pipe<boolean> {
	public transform(value: unknown, _context?: unknown): boolean {
		if (typeof value === "boolean") {
			return value;
		}

		const normalized = typeof value === "string" ? value.trim().toLowerCase() : value;

		switch (normalized) {
			case "true":
			case "1":
			case 1:
				return true;
			case "false":
			case "0":
			case 0:
				return false;
			default:
				throw new ValidationError("Validation failed", [invalidBooleanIssue]);
		}
	}
}

export class DatePipe extends Pipe<Date> {
	public transform(value: unknown, _context?: unknown): Date {
		if (value instanceof Date) {
			if (Number.isNaN(value.getTime())) {
				throw new ValidationError("Validation failed", [invalidDateIssue]);
			}
			return value;
		}

		if (typeof value === "string") {
			const trimmed = value.trim();
			if (trimmed === "") {
				throw new ValidationError("Validation failed", [invalidDateIssue]);
			}
			if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
				return new Date(Number(trimmed));
			}
			const parsed = new Date(trimmed);
			if (Number.isNaN(parsed.getTime())) {
				throw new ValidationError("Validation failed", [invalidDateIssue]);
			}
			return parsed;
		}

		if (typeof value === "number" && !Number.isNaN(value)) {
			return new Date(value);
		}

		throw new ValidationError("Validation failed", [invalidDateIssue]);
	}
}

export class JsonPipe extends Pipe<object> {
	public transform(value: string, context?: PipeContext): object {
		try {
			const obj = JSON.parse(value, (fieldKey, fieldValue) => {
				const val = this.reviver(context?.fieldTypes, fieldKey, fieldValue);
				return val;
			});
			return obj;
		} catch (err) {
			throw new TransformError(`Error parsing json ${err}`);
		}
	}

	private reviver(fieldTypes: Record<string, Type>, fieldKey: string, value: unknown) {
		if (!fieldKey) {
			return value;
		}

		if (!fieldTypes) {
			return value;
		}

		const fieldType = fieldTypes[fieldKey];

		if (fieldType == null) {
			return value;
		}

		if (!isDateType(fieldType)) {
			return value;
		}

		return new Date(value.toString());
	}
}

export class NumberPipe extends Pipe<number> {
	/** Finite numbers only. Blank or non-numeric input is a 400, not `undefined`. */
	public transform(value: unknown, _context?: unknown): number {
		const text = typeof value === "number" ? null : String(value).trim();
		const number = text == null ? (value as number) : text === "" ? Number.NaN : Number(text);
		if (!Number.isFinite(number)) {
			throw new ValidationError("Validation failed", [invalidNumberIssue]);
		}
		return number;
	}
}
