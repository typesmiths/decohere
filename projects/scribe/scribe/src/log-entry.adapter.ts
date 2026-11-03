import { type LogEntry, logEntry } from "./log-entry.js";
import { LogAdapter } from "./logger.adapter.js";
import type { BaseLogger, LogFn, Logger } from "./logger.type.js";
import { redact } from "./redact.js";
import { DefaultLogLevel, LogLevels, type ScribeOptions } from "./types.js";

/**
 * Base for adapters that write structured entries. It owns levels, the level
 * threshold, `child`, and censoring the `redactions` keys; a subclass only
 * writes each `LogEntry`.
 */
export abstract class LogEntryAdapter extends LogAdapter {
	protected levels: Record<string, number> = LogLevels;
	private level: string = DefaultLogLevel;
	private threshold: number = LogLevels.info;
	private redactionKeys: ReadonlySet<string> = redact.fromOptions();

	public configure<T extends string = never, CustomOnly extends true | false = false>(
		scribeOptions: ScribeOptions<T, CustomOnly>,
	) {
		this.levels = this.getLogLevels(scribeOptions);
		this.level = scribeOptions.logLevel ?? DefaultLogLevel;
		this.threshold = this.levels[this.level] ?? LogLevels.info;
		this.redactionKeys = redact.fromOptions(scribeOptions.redactions);
	}

	public getLogger<T extends string = never, CustomOnly extends true | false = false>(
		name?: string,
	): Logger<T, CustomOnly> {
		return this.createLogger<T, CustomOnly>(name || "default", {});
	}

	/** Write one entry that passed the level threshold. */
	protected abstract write(entry: LogEntry): void;

	private createLogger<T extends string = never, CustomOnly extends true | false = false>(
		name: string,
		bindings: Record<string, unknown>,
	): Logger<T, CustomOnly> {
		const { levels, level: currentLevel, threshold, redactionKeys } = this;

		const baseLogger: BaseLogger = {
			get currentLevel() {
				return currentLevel;
			},
			get logLevels() {
				return levels;
			},
		};
		const noop = () => {};
		const methods: Record<string, LogFn> = {};
		for (const [level, value] of Object.entries(levels)) {
			methods[level] =
				value >= threshold
					? (...args) =>
							this.write(logEntry.from(level, name, args, { bindings, redactionKeys }))
					: noop;
		}

		return Object.assign(baseLogger, methods, {
			isLevelEnabled: (level: string) => (levels[level] ?? 0) >= threshold,
			child: (fields: Record<string, unknown>) =>
				this.createLogger<T, CustomOnly>(name, { ...bindings, ...fields }),
		}) as Logger<T, CustomOnly>;
	}
}
