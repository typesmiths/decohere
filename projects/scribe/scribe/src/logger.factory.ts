import { ConsoleAdapter } from "./console.adapter.js";
import { resolveLogLevel } from "./env.js";
import { LoggingConfigurationError } from "./errors.js";
import { type LogEntry, logEntry } from "./log-entry.js";
import type { LoggerAdapter } from "./logger.adapter.js";
import type { Logger } from "./logger.type.js";
import { DefaultLogLevel, DefaultRedactions, type ScribeOptions } from "./types.js";

type LoggerFactoryOptions<
	T extends string = never,
	CustomOnly extends true | false = false,
> = {
	options?: ScribeOptions<T, CustomOnly>;
	adapter: LoggerAdapter;
	/**
	 * Called with every entry a `scribe.logger(...)` handle writes (levels the
	 * adapter has enabled). For error reporters such as Sentry. Scribe does not
	 * redact what it hands the tap; the tap, or the service behind it, does.
	 * A tap that throws does not break the call that logged: the error is
	 * rethrown on a microtask, where the runtime reports it as uncaught.
	 */
	tap?: LogTap;
};

export type LogTap = (entry: LogEntry) => void;

/**
 * Fields for whatever the caller is doing now, such as the request it serves.
 * Called on every log call; return `undefined` outside that work.
 */
export type LogContextSource = () => Record<string, unknown> | undefined;

export class scribe implements AsyncDisposable {
	private loggerProvider: LoggerAdapter;
	/** True after `configure({ adapter })` — the constructor’s ConsoleAdapter is only a fallback. */
	private adapterConfigured = false;
	private defaultAdapterWarned = false;
	private tap: LogTap | undefined;
	private static instance: scribe = new scribe();
	// Outlive configure(): a host adds its source once, adapters come and go.
	private static readonly contextSources = new Set<LogContextSource>();

	public static logger<T extends string = never, CustomOnly extends true | false = false>(
		name?: string,
		customLevels?: {
			[level in T]: number;
		},
	): Logger<T, CustomOnly> {
		// Apply custom levels once against the active adapter; the live handle
		// re-resolves the underlying logger on each use.
		if (customLevels) {
			scribe.instance.getLogger<T, CustomOnly>(name, customLevels);
		}
		return scribe.createLiveLogger<T, CustomOnly>(name);
	}

	public static configure<T extends string = never, CustomOnly extends true | false = false>(
		configOptions: LoggerFactoryOptions<T, CustomOnly>,
	) {
		const previous = scribe.instance;
		// Sync: stop writes into the old ThreadStream before a new worker starts.
		previous.retire();
		scribe.instance = new scribe();
		scribe.instance.configure<T, CustomOnly>(configOptions);
		// Async drain of the retired adapter (flush / end). Flux/App.dispose may
		// have already done this; reconfigure without stop still needs it.
		void previous.stop();
		return (name?: string) => scribe.logger<T, CustomOnly>(name);
	}

	/**
	 * Add fields to every line a `scribe.logger(...)` handle writes while
	 * `source` returns them: `@decohere/http` adds the request id this way.
	 * Adding the same source twice adds it once. Returns a function that
	 * removes it. Fields a child binds win over the source's.
	 */
	public static addContextSource(source: LogContextSource): () => void {
		scribe.contextSources.add(source);
		return () => {
			scribe.contextSources.delete(source);
		};
	}

	private static collectContext(): Record<string, unknown> | undefined {
		let context: Record<string, unknown> | undefined;
		for (const source of scribe.contextSources) {
			const fields = source();
			if (fields != null) {
				context = { ...context, ...fields };
			}
		}
		return context;
	}

	/**
	 * The context's fields that the log call doesn't pass itself: the call's own value wins, and a
	 * writer such as Pino would otherwise write the key twice.
	 */
	private static omitPassedFields(
		context: Record<string, unknown>,
		args: unknown[],
	): Record<string, unknown> {
		const passed = new Set(logEntry.getPassedFieldNames(args));
		const kept = Object.entries(context).filter(([key]) => !passed.has(key));
		return kept.length === Object.keys(context).length ? context : Object.fromEntries(kept);
	}

	public static flush(cb?: () => void): void {
		scribe.instance.loggerProvider.flush(cb);
	}

	/** Synchronously stop accepting writes on the active adapter. */
	public static retire(): void {
		scribe.instance.retire();
	}

	/** Drain the active adapter and release workers / destinations. */
	public static async stop(): Promise<void> {
		await scribe.instance.stop();
	}

	/**
	 * Module-level `const log = scribe.logger(...)` must follow a later
	 * `scribe.configure()` (CLI / Flux / HotReloadServer). Forward every use to
	 * the active adapter logger for `name`, and `child(fields)` to a live handle
	 * that adds `bindings`, so children follow a reconfigure too.
	 */
	private static createLiveLogger<
		T extends string = never,
		CustomOnly extends true | false = false,
	>(name?: string, bindings: Record<string, unknown> = {}): Logger<T, CustomOnly> {
		const resolve = (fields: Record<string, unknown>): Logger<T, CustomOnly> => {
			const root = scribe.instance.getLogger<T, CustomOnly>(name);
			return Object.keys(fields).length > 0 ? root.child(fields) : root;
		};
		return new Proxy({} as Logger<T, CustomOnly>, {
			get(_target, prop) {
				if (prop === "child") {
					return (fields: Record<string, unknown>) =>
						scribe.createLiveLogger<T, CustomOnly>(name, { ...bindings, ...fields });
				}
				const context = scribe.collectContext();
				const fields = context == null ? bindings : { ...context, ...bindings };
				const underlying = resolve(fields);
				const value = Reflect.get(underlying, prop, underlying);
				if (typeof value !== "function") {
					return value;
				}
				const method = (value as (...args: unknown[]) => unknown).bind(underlying);
				const instance = scribe.instance;
				if (
					typeof prop !== "string" ||
					!Object.hasOwn(underlying.logLevels, prop) ||
					!underlying.isLevelEnabled(prop) ||
					(instance.tap == null && context == null)
				) {
					return method;
				}
				return (...args: unknown[]) => {
					const kept = context == null ? context : scribe.omitPassedFields(context, args);
					if (kept === context) {
						method(...args);
						instance.notifyTap(prop, name ?? "default", args, fields);
						return;
					}
					const lineFields = { ...kept, ...bindings };
					const target = resolve(lineFields);
					(Reflect.get(target, prop, target) as (...a: unknown[]) => unknown).apply(
						target,
						args,
					);
					instance.notifyTap(prop, name ?? "default", args, lineFields);
				};
			},
			has(_target, prop) {
				return Reflect.has(resolve(bindings), prop);
			},
		});
	}

	public constructor() {
		// Initialize with default console adapter
		this.loggerProvider = new ConsoleAdapter();
		const defaultOptions = this.mergeDefaults();
		this.loggerProvider.configure(defaultOptions);
	}

	public configure<T extends string = never, CustomOnly extends true | false = false>(
		configOptions: LoggerFactoryOptions<T, CustomOnly>,
	): (name?: string) => Logger<T, CustomOnly> {
		const { adapter, options, tap } = configOptions;
		const previous = this.loggerProvider;
		if (previous !== adapter) {
			previous.retire();
		}
		this.loggerProvider = adapter;
		this.adapterConfigured = true;
		this.tap = tap;
		const defaultsAndOptions = this.mergeDefaults<T, CustomOnly>(options);
		adapter.configure(defaultsAndOptions);
		if (previous !== adapter) {
			void previous.stop();
		}
		return (name?: string) => scribe.logger<T, CustomOnly>(name);
	}

	public retire(): void {
		this.loggerProvider.retire();
	}

	public async stop(): Promise<void> {
		await this.loggerProvider.stop();
	}

	public async [Symbol.asyncDispose](): Promise<void> {
		await this.stop();
	}

	public getLogger<T extends string = never, CustomOnly extends true | false = false>(
		name?: string,
		customLevels?: {
			[level in T]: number;
		},
	): Logger<T, CustomOnly> {
		this.warnIfDefaultAdapter();

		// If custom levels are provided, we need to reconfigure the adapter
		if (customLevels) {
			const currentOptions = this.mergeDefaults({ customLevels });
			this.loggerProvider.configure(currentOptions);
		}

		const logger = this.loggerProvider.getLogger(name) as Logger<T, CustomOnly>;
		this.supportsLevels(customLevels, logger);
		return logger;
	}

	private notifyTap(
		level: string,
		name: string,
		args: readonly unknown[],
		bindings: Record<string, unknown>,
	): void {
		const tap = this.tap;
		if (tap == null) {
			return;
		}
		try {
			tap(logEntry.from(level, name, args, { bindings }));
		} catch (err) {
			// Not swallowed: the logging call returns, the runtime reports the tap's error.
			queueMicrotask(() => {
				throw err;
			});
		}
	}

	private warnIfDefaultAdapter(): void {
		if (this.adapterConfigured || this.defaultAdapterWarned) {
			return;
		}
		this.defaultAdapterWarned = true;
		// console.warn, not the stderr stream: the facade runs in browsers and Workers too.
		console.warn(
			"[scribe] No logger adapter configured; using the default ConsoleAdapter. " +
				"Configure an adapter at your composition root (for production, prefer " +
				"@decohere/scribe-pino → JSON on stdout). See " +
				"https://github.com/typesmiths/decohere/blob/main/projects/scribe/README.md",
		);
	}

	private supportsLevels<T extends string = never, CustomOnly extends true = undefined>(
		customLevels: {
			[level in T]: number;
		},
		logger: Logger<T, CustomOnly>,
	) {
		if (!customLevels) {
			return;
		}

		const missingLevel = Object.entries(customLevels).find(
			(key) => !logger.logLevels[key.at(0).toString()],
		);

		if (missingLevel != null) {
			throw new LoggingConfigurationError(
				`Current logger was not configured for custom level ${missingLevel}, valid levels are: ${JSON.stringify(logger.logLevels)}`,
			);
		}
		return { missingLevel };
	}

	private mergeDefaults<T extends string = never, CustomOnly extends true | false = false>(
		options?: ScribeOptions<T, CustomOnly>,
	): ScribeOptions<T, CustomOnly> {
		const logLevel = resolveLogLevel(options?.logLevel) ?? DefaultLogLevel;
		// Resolved logLevel must win over options spread (invalid explicit values
		// would otherwise stick).
		return { redactions: DefaultRedactions, ...options, logLevel };
	}
}
