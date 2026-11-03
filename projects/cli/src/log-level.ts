import { DefaultLogLevel, resolveLogLevel } from "@decohere/scribe";

/**
 * The level a bin logs at: `--log-level`, then a level from the environment, then `trace` when
 * FORGE_TRACE is set (so `@trace` timings show), then scribe's default.
 */
export function cliLogLevel(flag?: string): string {
	return (
		resolveLogLevel(flag) ?? (process.env.FORGE_TRACE != null ? "trace" : DefaultLogLevel)
	);
}
