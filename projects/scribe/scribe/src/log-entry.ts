import { type SerializedError, serializeError } from "./logger.adapter.js";
import { redact } from "./redact.js";

/**
 * One logged call. Adapters that write structured lines build it with
 * `logEntry.from`, and taps receive it.
 */
export type LogEntry = {
	level: string;
	name: string;
	msg?: string;
	err?: SerializedError;
	/** Bound fields (`child`), then the call's own fields. */
	fields: Record<string, unknown>;
};

export type LogEntryOptions = {
	bindings?: Record<string, unknown>;
	/**
	 * Keys the adapter censors (`redact.fromOptions`). Redaction is the
	 * adapter's job, so the facade's tap passes none.
	 */
	redactionKeys?: ReadonlySet<string>;
};

function isFields(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

/** Serialize errors passed as fields (`{ error }`), so they keep their message and stack. */
function serializeErrors(fields: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(fields)) {
		out[key] = value instanceof Error ? serializeError(value) : value;
	}
	return out;
}

/**
 * Builds an entry from a log call's arguments:
 *
 * - `log.info("text")`, `log.info(42)` → `msg`
 * - `log.error(err)` → `msg` is `err.message`, `err` the serialized error
 * - `log.info({ fields })`, `log.info({ fields }, "text")` → `fields` (a string
 *   `msg` field becomes the message)
 * - `log.info("text", { fields })` → `msg` + `fields`
 * - `log.error("text", err)` → `msg` + `err`
 * - `log.info("text", value)` → `msg` + `fields.data`; any further arguments go
 *   in `fields.args`
 */
function from(
	level: string,
	name: string,
	[first, ...rest]: readonly unknown[],
	{ bindings, redactionKeys }: LogEntryOptions,
): LogEntry {
	let msg: string | undefined;
	let err: Error | undefined;
	let fields: Record<string, unknown> = {};

	if (first instanceof Error) {
		err = first;
		msg = first.message;
	} else if (isFields(first)) {
		const { msg: fieldMsg, ...others } = first;
		fields = others;
		if (typeof fieldMsg === "string") {
			msg = fieldMsg;
		} else if (fieldMsg !== undefined) {
			fields.msg = fieldMsg;
		}
		if (typeof rest[0] === "string") {
			msg = rest.shift() as string;
		}
	} else if (first !== undefined) {
		msg = String(first);
	}

	const [second, ...extra] = rest;
	if (second instanceof Error && err == null) {
		err = second;
	} else if (isFields(second)) {
		fields = { ...fields, ...second };
	} else if (second !== undefined) {
		fields.data = second;
	}
	if (extra.length > 0) {
		fields.args = extra;
	}

	const allFields = serializeErrors({ ...bindings, ...fields });
	const entry: LogEntry = {
		level,
		name,
		fields:
			redactionKeys == null
				? allFields
				: (redact.object(allFields, redactionKeys) as Record<string, unknown>),
	};
	if (msg !== undefined) {
		entry.msg = msg;
	}
	if (err != null) {
		const serialized = serializeError(err);
		entry.err =
			redactionKeys == null
				? serialized
				: (redact.object(serialized, redactionKeys) as SerializedError);
	}
	return entry;
}

/**
 * The names of the fields a log call passes itself, read the way `from` reads them: an object
 * first (`log.info({ orderId }, "text")`) or second (`log.info("text", { orderId })`).
 */
function getPassedFieldNames([first, second]: readonly unknown[]): string[] {
	const names: string[] = [];
	if (!(first instanceof Error) && isFields(first)) names.push(...Object.keys(first));
	if (!(second instanceof Error) && isFields(second)) names.push(...Object.keys(second));
	return names;
}

export const logEntry = { from, getPassedFieldNames };
