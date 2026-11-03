import { type LogEntry, LogEntryAdapter, LogLevels, serializeError } from "@decohere/scribe";

export type JsonConsoleAdapterOptions = {
	/**
	 * Add `time` (ISO 8601) to every line. Off by default: hosts such as Workers
	 * Logs and browser devtools stamp each line themselves.
	 */
	timestamp?: boolean;
};

type ConsoleMethod = "error" | "warn" | "info" | "debug";

/**
 * Writes one JSON object per entry, `{ level, name, msg, ...fields, err }`,
 * through the console method of its level, so hosts that index JSON console
 * lines (Workers Logs, browser devtools) see the level too. Uses nothing but
 * `console` and `JSON`: it runs on Workers, in browsers, Deno, Bun and Node.
 */
export class JsonConsoleAdapter extends LogEntryAdapter {
	private readonly timestamp: boolean;

	public constructor(options: JsonConsoleAdapterOptions = {}) {
		super();
		this.timestamp = options.timestamp ?? false;
	}

	protected write(entry: LogEntry): void {
		const method = methodFor(this.levels[entry.level] ?? LogLevels.info);
		console[method](stringify(toLine(entry, this.timestamp)));
	}
}

/**
 * Custom levels pick the method of the default level at or below them:
 * `fatal` and `error` → `console.error`, `warn` → `console.warn`, `info` →
 * `console.info`, `debug` and `trace` → `console.debug` (`console.trace` would
 * print a stack).
 */
function methodFor(value: number): ConsoleMethod {
	if (value >= LogLevels.error) {
		return "error";
	}
	if (value >= LogLevels.warn) {
		return "warn";
	}
	if (value >= LogLevels.info) {
		return "info";
	}
	return "debug";
}

/** `level`, `name`, `time` and `msg` are the entry's own; a field cannot replace them. */
function toLine(entry: LogEntry, timestamp: boolean): Record<string, unknown> {
	const line: Record<string, unknown> = { level: entry.level, name: entry.name };
	if (timestamp) {
		line.time = new Date().toISOString();
	}
	if (entry.msg !== undefined) {
		line.msg = entry.msg;
	}
	for (const [key, value] of Object.entries(entry.fields)) {
		if (!(key in line)) {
			line[key] = value;
		}
	}
	if (entry.err != null) {
		line.err = entry.err;
	}
	return line;
}

/** `JSON.stringify` that survives cycles and bigints, and serializes nested errors. */
function stringify(line: Record<string, unknown>): string {
	const ancestors: object[] = [];
	return JSON.stringify(line, function (this: unknown, _key: string, value: unknown) {
		if (typeof value === "bigint") {
			return value.toString();
		}
		if (value == null || typeof value !== "object") {
			return value;
		}
		while (ancestors.length > 0 && ancestors.at(-1) !== this) {
			ancestors.pop();
		}
		if (ancestors.includes(value)) {
			return "[Circular]";
		}
		if (value instanceof Error) {
			// Track the error too: its serialized properties may point back at it.
			const serialized = serializeError(value);
			ancestors.push(value, serialized);
			return serialized;
		}
		ancestors.push(value);
		return value;
	});
}
