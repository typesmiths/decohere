import { formatError, LogAdapter } from "./logger.adapter.js";
import type { BaseLogger, Logger } from "./logger.type.js";
import { redact } from "./redact.js";
import {
	DefaultLogLevel,
	type LogAdapterOptions,
	LogLevels,
	type ScribeOptions,
} from "./types.js";

export type ConsoleAdapterOptions = {} & LogAdapterOptions;

export class ConsoleAdapter extends LogAdapter {
	private configuredLevels: Record<string, number>;
	private configuredLogLevel: string = DefaultLogLevel;
	private configuredLogLevelValue: number = LogLevels.info;
	private redactionKeys: ReadonlySet<string> = redact.fromOptions();

	public constructor(_options: ConsoleAdapterOptions = {}) {
		super();
	}

	public configure<T extends string = never, CustomOnly extends true | false = false>(
		scribeOptions: ScribeOptions<T, CustomOnly>,
	) {
		this.configuredLevels = this.getLogLevels(scribeOptions);
		const logLevelStr = scribeOptions.logLevel ?? DefaultLogLevel;
		this.configuredLogLevel = logLevelStr;
		this.configuredLogLevelValue = this.configuredLevels[logLevelStr] ?? LogLevels.info;
		this.redactionKeys = redact.fromOptions(scribeOptions.redactions);
	}

	public getLogger<T extends string = never, CustomOnly extends true | false = false>(
		name?: string,
	): Logger<T, CustomOnly> {
		const loggerName = name || "default";
		return this.createConsoleLogger<T, CustomOnly>(loggerName, {});
	}

	private createConsoleLogger<
		T extends string = never,
		CustomOnly extends true | false = false,
	>(name: string, bindings: Record<string, unknown>): Logger<T, CustomOnly> {
		const allLevels = this.configuredLevels;
		const currentLevel = this.configuredLogLevel;
		const threshold = this.configuredLogLevelValue;
		const redactionKeys = this.redactionKeys;
		const bound =
			Object.keys(bindings).length > 0 ? [redact.object(bindings, redactionKeys)] : [];

		const baseLogger: BaseLogger = {
			get currentLevel() {
				return currentLevel;
			},
			get logLevels() {
				return allLevels;
			},
		};

		const logFunction =
			(level: string) =>
			(msg: string | number | object, ...args: unknown[]) => {
				const timestamp = new Date().toISOString();
				let message: string;

				if (typeof msg === "object") {
					message =
						msg instanceof Error
							? formatError(msg)
							: JSON.stringify(redact.object(msg, redactionKeys));
				} else {
					message = String(msg);
				}

				const logLine = `[${timestamp}] ${level.toUpperCase()} [${name}]: ${message}`;
				const payload = [...args.map((arg) => redact.object(arg, redactionKeys)), ...bound];

				if (payload.length > 0) {
					console.log(logLine, ...payload);
				} else {
					console.log(logLine);
				}
			};

		const noop = () => {};

		const logger = Object.assign(baseLogger, {
			isLevelEnabled: (level: string) => (allLevels[level] ?? 0) >= threshold,
			child: (fields: Record<string, unknown>) =>
				this.createConsoleLogger<T, CustomOnly>(name, { ...bindings, ...fields }),
		});

		for (const [levelName, levelValue] of Object.entries(allLevels)) {
			(logger as any)[levelName] = levelValue >= threshold ? logFunction(levelName) : noop;
		}

		return logger as Logger<T, CustomOnly>;
	}
}
