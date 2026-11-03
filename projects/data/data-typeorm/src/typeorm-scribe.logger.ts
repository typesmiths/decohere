import type { Dialect, Provider } from "@decohere/data";
import { cache } from "@decohere/core/caching";
import { type DefaultLevels, type Logger, scribe } from "@decohere/scribe";
import {
	AbstractLogger,
	type LogLevel,
	type LogMessage,
	type LogMessageType,
	type QueryRunner,
} from "typeorm";

const MessageTypeMap = {
	log: "info",
	info: "info",
	query: "info",
	warn: "warn",
	error: "error",
	"query-error": "error",
	"query-slow": "warn",
	"schema-build": "info",
	migration: "info",
} satisfies Record<LogMessageType, DefaultLevels>;

export class TypeOrmScribeLogger extends AbstractLogger {
	private readonly logger: Logger;
	private readonly dialect: Dialect | Provider;
	public constructor(name: string, dialect: Dialect | Provider, enable: boolean = true) {
		super(enable);
		this.dialect = dialect;
		this.logger = scribe.logger(`${name ?? "TypeOrm"}`);
	}

	protected writeLog(
		level: LogLevel,
		logMessage: LogMessage | LogMessage[],
		_queryRunner?: QueryRunner,
	) {
		const messages = Array.isArray(logMessage) ? logMessage : [logMessage];
		for (const message of messages) {
			const logLevel = this.getLogLevel(message.type);
			const prefix = message.type ?? level;
			const statement = { sql: { statement: message.message, language: this.dialect } };
			this.logger[logLevel](prefix, statement);
		}
	}

	@cache()
	private getLogLevel(type: LogMessageType | LogLevel) {
		const level = Object.entries(MessageTypeMap)
			.find(([key]) => type === key)
			?.at(1);

		return this.logger.isLevelEnabled(level) ? level : this.logger.currentLevel;
	}
}
