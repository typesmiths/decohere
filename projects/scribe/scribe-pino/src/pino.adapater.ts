import {
	type BaseLogger,
	formatError,
	LogAdapter,
	type Logger,
	type ScribeOptions,
} from "@decohere/scribe";
import pino, { type LogFn } from "pino";

import type { GuardedTransport } from "./pino.transport-guard.js";

export type PinoAdapaterOptions = {
	options?: pino.LoggerOptions;
	stream?: pino.DestinationStream;
};

type EndableStream = {
	end?: (cb?: (err?: Error | null) => void) => void;
	destroy?: (error?: Error) => void;
	destroyed?: boolean;
	closed?: boolean;
	writableFinished?: boolean;
	flushSync?: () => void;
	once?: (
		event: "finish" | "close" | "error",
		listener: (...args: never[]) => void,
	) => unknown;
	off?: (event: "finish" | "close" | "error", listener: (...args: never[]) => void) => unknown;
};

export class PinoAdapter extends LogAdapter {
	private _pino: pino.Logger;
	private readonly options: pino.LoggerOptions;
	private readonly stream: pino.DestinationStream | undefined;
	private disposed = false;
	private retired = false;

	public constructor(options: pino.LoggerOptions, stream?: pino.DestinationStream) {
		super();
		this.options = options;
		this.stream = stream;
	}

	public configure<T extends string = never, CustomOnly extends true | false = false>(
		scribeOptions: ScribeOptions<T, CustomOnly>,
	) {
		const { logLevel, redactions } = scribeOptions;
		const customLevels = this.getLogLevels(scribeOptions);

		const pinoOptions: pino.LoggerOptions = {
			customLevels,
			level: logLevel,
			hooks: { logMethod },
			serializers: {
				error: pino.stdSerializers.err,
			},
			redact: redactions,
			...this.options,
		};
		this._pino = pino(pinoOptions, this.stream);
	}

	public getLogger<T extends string = never, CustomOnly extends true | false = false>(
		name: string,
	): Logger<T, CustomOnly> {
		const logger = pinoMix<T, CustomOnly>(this._pino.child({ name }));
		return logger;
	}

	public flush(cb?: () => void): void {
		if (this.retired || !this._pino) {
			cb?.();
			return;
		}
		// pino.transport() is a ThreadStream: its flush() waits with no time limit and can miss
		// the wake-up, and its worker then keeps the process alive, so a CLI waiting on this
		// callback never exits. flushSync() gives up with an error after 10 seconds instead.
		const dest = this.stream as EndableStream | undefined;
		if (typeof dest?.flushSync === "function") {
			dest.flushSync();
			cb?.();
			return;
		}
		this._pino.flush(cb);
	}

	/**
	 * Immediately stop accepting writes into the destination (ThreadStream).
	 * Does not wait for flush — use `stop()` for async drain after retire.
	 */
	public retire(): void {
		if (this.retired) {
			return;
		}
		this.retired = true;
		const guarded = this.stream as GuardedTransport | undefined;
		if (typeof guarded?.retire === "function") {
			guarded.retire("adapter retired");
			return;
		}
		destroyDestination(this.stream);
	}

	public async [Symbol.asyncDispose](): Promise<void> {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		if (!this.retired) {
			const dest = this.stream as EndableStream | undefined;
			if (dest != null && typeof dest.end === "function") {
				// pino.transport() is a ThreadStream: pino.flush() → Atomics.waitAsync can
				// hang forever after concurrent writes. end() flushSyncs then signals
				// finish/close (it does not accept a Node Writable callback).
				await endDestination(dest);
			} else if (this._pino) {
				await new Promise<void>((resolve, reject) => {
					try {
						this._pino.flush((err?: Error | null) => {
							if (err != null) {
								reject(err);
								return;
							}
							resolve();
						});
					} catch (err) {
						reject(err instanceof Error ? err : new Error(String(err)));
					}
				});
			}
		}
		// Mark dead after graceful end (or immediately if already force-retired).
		this.retire();
	}
}

function destroyDestination(stream: pino.DestinationStream | undefined): void {
	const destroyable = stream as EndableStream | undefined;
	if (typeof destroyable?.destroy === "function") {
		try {
			destroyable.destroy();
		} catch {
			// already dead
		}
	}
}

/**
 * Drain a pino destination.
 *
 * Node `Writable.end(cb)` invokes `cb`. `pino.transport()` returns a
 * ThreadStream whose `end()` takes no callback and signals via `finish`/`close`
 * instead — waiting only on `end(cb)` hangs forever and blocks Flux HMR.
 */
function endDestination(stream: EndableStream): Promise<void> {
	if (typeof stream.end !== "function") {
		return Promise.resolve();
	}
	if (stream.destroyed || stream.closed || stream.writableFinished) {
		return Promise.resolve();
	}

	return new Promise<void>((resolve, reject) => {
		let settled = false;
		const settle = (err?: Error | null) => {
			if (settled) {
				return;
			}
			settled = true;
			stream.off?.("finish", onFinish);
			stream.off?.("close", onClose);
			stream.off?.("error", onError);
			if (err != null) {
				reject(err);
				return;
			}
			resolve();
		};

		const onFinish = () => settle();
		const onClose = () => settle();
		const onError = (err: Error) => {
			// ThreadStream may emit error then close during teardown; closed = done.
			if (stream.destroyed || stream.closed) {
				settle();
				return;
			}
			settle(err);
		};

		stream.once?.("finish", onFinish);
		stream.once?.("close", onClose);
		stream.once?.("error", onError);

		try {
			stream.end((err?: Error | null) => settle(err));
		} catch (err) {
			settle(err instanceof Error ? err : new Error(String(err)));
			return;
		}

		// ThreadStream.end() is a no-op when already destroyed (no events).
		if (stream.destroyed || stream.closed || stream.writableFinished) {
			settle();
		}
	});
}

function logMethod(this: pino.Logger, args: Parameters<LogFn>, method: LogFn) {
	let message = args.at(0);
	const data = args.at(1);

	if (message instanceof Error) {
		method.call(this, { err: message }, formatError(message));
		return;
	}

	// Fields first, `log.info({ orderId }, "text")`: Pino's own order.
	if (message != null && typeof message === "object" && !Array.isArray(message)) {
		const fields = data instanceof Error ? { ...message, error: data } : message;
		if (typeof data === "string") {
			method.call(this, fields, data);
		} else {
			method.call(this, fields);
		}
		return;
	}

	if (data instanceof Error) {
		message = {
			msg: message,
			error: data,
		};
	} else if (typeof data === "object") {
		message = { msg: message, ...data };
	} else {
		message = { msg: message, data };
	}

	method.call(this, message);
}

/**
 * Add Scribe's logger members to a Pino logger. `spawn` is Pino's own `child`:
 * a Pino child inherits its parent's members through the prototype, so
 * `logger.child` would be the parent's override.
 */
function pinoMix<T extends string = never, CustomOnly extends true | false = false>(
	logger: pino.Logger,
	spawn: pino.Logger["child"] = logger.child,
): Logger<T, CustomOnly> {
	return Object.assign<pino.Logger, BaseLogger & Pick<Logger<T, CustomOnly>, "child">>(
		logger,
		{
			get currentLevel() {
				return logger.level;
			},
			get logLevels() {
				return logger.levels.values;
			},
			child: (fields: Record<string, unknown>) =>
				pinoMix<T, CustomOnly>(spawn.call(logger, fields), spawn),
		},
	) as Logger<T, CustomOnly>;
}
