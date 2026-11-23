import pinoLogger from "pino";
import { PinoAdapter } from "./pino.adapter.js";
import {
	type PinoPrettyOptions,
	type PinoRollOptions,
	PinoTargets,
	type PinoTransport,
} from "./pino-targets.value.js";
import { TransportGuard } from "./transport-guard.service.js";

export type PinoOptions = {
	/** Colourised lines through pino-pretty, for a terminal. */
	pretty?: boolean | PinoPrettyOptions;
	/** Rolling log files through pino-roll. With `pretty`, both get every entry. */
	roll?: PinoRollOptions;
	/** Any other Pino transport, in place of `pretty` and `roll`. */
	transport?: PinoTransport;
	/** Pino's own logger options, over the ones Scribe sets. */
	logger?: pinoLogger.LoggerOptions;
};

/**
 * Pino as Scribe's writer: `scribe.use(pino())`. With no options it writes JSON lines to stdout,
 * which is what production wants: the platform ships them. `pretty` and `roll` are for a developer's
 * machine; the app's entry decides when to ask for them, as nothing here reads the environment.
 *
 * ```ts
 * const development = process.env.NODE_ENV !== "production";
 * scribe.use(pino(development ? { pretty: true, roll: { file: "logs/api.log" } } : {}));
 * ```
 *
 * A worker transport is guarded ({@link TransportGuard}): if it dies, logging stops with one line on
 * stderr instead of crashing the process.
 */
export function pino(options: PinoOptions = {}): PinoAdapter {
	const pretty = options.pretty === true ? {} : options.pretty || undefined;
	const transport = options.transport ?? new PinoTargets(pretty, options.roll).transport;
	if (transport == null) return new PinoAdapter(options.logger);
	return new PinoAdapter(options.logger, new TransportGuard(pinoLogger.transport(transport)));
}
