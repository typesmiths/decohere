import type { LogQuery } from "@decohere/data";
import pinoPretty from "pino-pretty";
import { PlatformTools } from "typeorm/platform/PlatformTools.js";

export const SqlPretty = (opts?) =>
	pinoPretty({
		colorizeObjects: true,
		customLevels:
			Object.entries(opts?.levels ?? [])
				.map(([key, value]) => `${key}:${value}`)
				.join(",") ?? [],

		customPrettifiers: {
			sql: tryParseSql,
		},

		...opts,
	});

function tryParseSql(value: string | LogQuery) {
	const isString = typeof value === "string";
	const statement = isString ? value : value.statement;
	try {
		const formatted = PlatformTools.highlightSql(PlatformTools.formatSql(statement));
		return formatted;
	} catch {
		return statement;
	}
}
