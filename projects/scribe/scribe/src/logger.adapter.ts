import type { Logger } from "./logger.type.js";
import { LogLevels, type ScribeOptions } from "./types.js";

export function formatError(err: Error): string {
	return err.stack ?? err.message;
}

export type SerializedError = {
	name: string;
	message: string;
	stack?: string;
	cause?: unknown;
	/** Own enumerable properties such as `code` or `statusCode`. */
	[property: string]: unknown;
};

/** How many causes deep `serializeError` follows by default. */
export const DefaultErrorCauseDepth = 3;

/**
 * Plain-object form of an error for structured logs. An `Error` cause, or an
 * `Error` in another own property, is serialized the same way, up to
 * `causeDepth` levels; any other value is kept as it is.
 */
export function serializeError(
	err: Error,
	causeDepth: number = DefaultErrorCauseDepth,
): SerializedError {
	const out: SerializedError = { name: err.name, message: err.message };
	if (err.stack != null) {
		out.stack = err.stack;
	}
	for (const [key, value] of Object.entries(err)) {
		if (key === "cause" || key in out) {
			continue;
		}
		if (!(value instanceof Error)) {
			out[key] = value;
		} else if (causeDepth > 0) {
			out[key] = serializeError(value, causeDepth - 1);
		}
	}
	const { cause } = err;
	if (cause instanceof Error) {
		if (causeDepth > 0) {
			out.cause = serializeError(cause, causeDepth - 1);
		}
	} else if (cause !== undefined) {
		out.cause = cause;
	}
	return out;
}

export interface LoggerAdapter extends AsyncDisposable {
	configure<T extends string = never, CustomOnly extends true | false = false>(
		options: ScribeOptions<T, CustomOnly>,
	);
	getLogger<T extends string = never, CustomOnly extends true | false = false>(
		name: string,
	): Logger<T, CustomOnly>;
	flush(cb?: () => void): void;
	/**
	 * Synchronously stop accepting writes (kill ThreadStream / close fds).
	 * Call before swapping adapters so a dead worker cannot spam on further logs.
	 * Idempotent — safe to call more than once.
	 */
	retire(): void;
	/**
	 * Drain buffered output and release unmanaged handles (workers, fds).
	 * Idempotent — safe to call more than once.
	 */
	stop(): Promise<void>;
}

export abstract class LogAdapter implements LoggerAdapter {
	public abstract configure<T extends string = never, CustomOnly extends true | false = false>(
		options: ScribeOptions<T, CustomOnly>,
	);

	public abstract getLogger<T extends string = never, CustomOnly extends true | false = false>(
		name: string,
	): Logger<T, CustomOnly>;

	public flush(cb?: () => void): void {
		cb?.();
	}

	public retire(): void {
		// Console / no-op adapters have nothing to release.
	}

	public async stop(): Promise<void> {
		await this[Symbol.asyncDispose]();
	}

	public async [Symbol.asyncDispose](): Promise<void> {
		// Console / no-op adapters have nothing to release.
	}

	protected getLogLevels(options: ScribeOptions<any, any>): Record<string, number> {
		const { customOnly, customLevels } = options;
		if (customOnly) {
			return customLevels;
		}
		const levels = this.getUniqueLevels(LogLevels, customLevels);
		return Object.fromEntries(levels);
	}

	protected getUniqueLevels(
		defaultLevels: Record<string, number>,
		customLevels: Record<string, number>,
	) {
		const defaultEntries = Object.entries(defaultLevels ?? {});
		const customEntries = Object.entries(customLevels ?? {});
		const defaultNotInCustom = defaultEntries.filter(
			([dk]) => customEntries.findIndex(([ck]) => ck === dk) === -1,
		);

		const unique = defaultNotInCustom.concat(customEntries);
		return unique;
	}
}
