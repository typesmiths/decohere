import type { DefaultLevels } from "./types.js";

/**
 * Environment variable names checked in order of precedence.
 * The first non-empty value found is used.
 */
const ENV_VAR_NAMES = ["LOG_LEVEL", "SCRIBE_LOG_LEVEL", "LOGGING_LEVEL"] as const;

const VALID_LEVELS: DefaultLevels[] = ["fatal", "error", "warn", "info", "debug", "trace"];

/**
 * Reads the log level from environment variables.
 * Checks LOG_LEVEL, SCRIBE_LOG_LEVEL, and LOGGING_LEVEL in order.
 * Returns null if none are set, or if the runtime has no `process` (browsers).
 */
export function getLogLevelFromEnv(): string | null {
	const env = globalThis.process?.env;
	for (const name of ENV_VAR_NAMES) {
		const value = env?.[name]?.trim().toLowerCase();
		if (value) {
			return value;
		}
	}
	return null;
}

/**
 * Reads a log-level flag from argv.
 * Supports: --log-level <value>, -l <value>, and --log-level=<value>
 */
export function getLogLevelFromArgv(argv: readonly string[]): string | undefined {
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--log-level" || arg === "-l") {
			return argv[index + 1];
		}
		if (arg.startsWith("--log-level=")) {
			return arg.slice("--log-level=".length);
		}
	}

	return undefined;
}

/**
 * Returns true if the given string is a recognised default log level.
 */
export function isValidLogLevel(level: string): level is DefaultLevels {
	return (VALID_LEVELS as string[]).includes(level);
}

export type ResolveLogLevelOptions = {
	explicitLogLevel?: string | null;
	envLogLevel?: string | null;
	defaultLogLevel: string;
};

/**
 * Resolves log level with precedence: explicit > env > default.
 * Invalid explicit/env levels fall back to default.
 */
export function resolveLogLevel(explicitLogLevel?: string | null): string | null;
export function resolveLogLevel(options: ResolveLogLevelOptions): string;
export function resolveLogLevel(arg?: string | null | ResolveLogLevelOptions): string | null {
	if (typeof arg === "string") {
		if (isValidLogLevel(arg)) {
			return arg;
		}

		const envLogLevel = getLogLevelFromEnv();
		if (envLogLevel != null && isValidLogLevel(envLogLevel)) {
			return envLogLevel;
		}

		return null;
	}

	if (arg == null) {
		const envLogLevel = getLogLevelFromEnv();
		if (envLogLevel != null && isValidLogLevel(envLogLevel)) {
			return envLogLevel;
		}

		return null;
	}

	const { explicitLogLevel, envLogLevel, defaultLogLevel } = arg;
	if (explicitLogLevel != null && isValidLogLevel(explicitLogLevel)) {
		return explicitLogLevel;
	}

	const resolvedEnvLogLevel = envLogLevel ?? getLogLevelFromEnv();
	if (resolvedEnvLogLevel != null && isValidLogLevel(resolvedEnvLogLevel)) {
		return resolvedEnvLogLevel;
	}

	return defaultLogLevel;
}
