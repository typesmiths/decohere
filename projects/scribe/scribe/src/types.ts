const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace"] as const;

export type LogLevel = typeof LOG_LEVELS;

export type DefaultLevels = LogLevel[number];

export const LogLevels = {
	fatal: 60,
	error: 50,
	warn: 40,
	info: 30,
	debug: 20,
	trace: 10,
} satisfies Record<DefaultLevels, number>;

export const DefaultLogLevel: DefaultLevels = "info";

export type RedactionOptions = {
	paths: string[];
};

/** Pino's default censor. ConsoleAdapter uses the same placeholder. */
export const DefaultCensor = "[Redacted]";

/**
 * Object keys Scribe redacts. Adapters apply this list — Pino via `redact.paths`
 * (top-level and one nest), ConsoleAdapter via `redact.object`.
 */
export const DefaultRedactionKeys = [
	"password",
	"secret",
	"token",
	"otp",
	"pw",
	"userconfig",
] as const;

export const DefaultRedactions: RedactionOptions = {
	paths: DefaultRedactionKeys.flatMap((key) => [key, `*.${key}`]),
};

export interface ScribeOptions<
	T extends string = never,
	CustomOnly extends true | false = undefined,
> {
	logLevel?: DefaultLevels | string;
	customLevels?: {
		[level in T]: number;
	};
	customOnly?: CustomOnly;
	redactions?: RedactionOptions;
}

export type LogAdapterOptions = Record<string, never>;
