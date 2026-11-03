import { extension } from "@decohere/core/extensibility";
import { DefaultEnvironment, type Environment } from "@decohere/core/system";
import {
	type DefaultLevels,
	type Logger,
	LoggingConfigurationError,
	type ScribeOptions,
	scribe,
} from "@decohere/scribe";
import pino, {
	type DestinationStream,
	type TransportMultiOptions,
	type TransportPipelineOptions,
	type TransportSingleOptions,
} from "pino";

import { PinoAdapter } from "./pino.adapater.js";
import {
	type PinoPrettyRecipeOptions,
	type PinoRecipePlan,
	type PinoRollRecipeOptions,
	pinoRecipe,
} from "./pino.recipe.js";
import { type GuardedTransport, guardTransport } from "./pino.transport-guard.js";

export type { GuardedTransport } from "./pino.transport-guard.js";
export { guardTransport } from "./pino.transport-guard.js";

type TransportOptions =
	TransportSingleOptions | TransportMultiOptions | TransportPipelineOptions;

type TransportConfig = {
	environment?: Environment;
	transports: TransportOptions;
};

type CustomLevelOptions<T extends string = never, CustomOnly extends true = undefined> = {
	scribe?: ScribeOptions<T, CustomOnly>;
	transports?: TransportConfig | TransportConfig[];
};

export type PinoLoggerFactory = (name?: string) => Logger;

export type PinoRecipeChain = {
	withPinoPretty(
		logLevelOrOptions?: DefaultLevels | string | PinoPrettyRecipeOptions,
	): PinoRecipe;
	withPinoRoll(options: PinoRollRecipeOptions): PinoRecipe;
};

export type PinoRecipe = PinoLoggerFactory &
	PinoRecipeChain & {
		readonly and: PinoRecipeChain;
	};

declare module "@decohere/scribe" {
	interface scribe {
		withPino(
			transports: TransportConfig | TransportConfig[],
			loglevel?: DefaultLevels | string,
		): PinoLoggerFactory;
		/**
		 * Colorized pretty transport. Development only unless `{ when: "always" }`.
		 * Chain with `.and.withPinoRoll({ file })`. Production writes JSON to stdout
		 * so log shipping stays outside the process.
		 */
		withPinoPretty(
			logLevelOrOptions?: DefaultLevels | string | PinoPrettyRecipeOptions,
		): PinoRecipe;
		/**
		 * Rolling log files. Development only unless `{ when: "always" }`.
		 * Do not enable in production — ship stdout from a sidecar or platform agent.
		 * `symlink` defaults off; enabling it can race under multi-worker / HMR.
		 * Ops may override path/size/frequency/keep via `SCRIBE_LOG_FILE`,
		 * `SCRIBE_LOG_SIZE`, `SCRIBE_LOG_FREQUENCY`, and `SCRIBE_LOG_KEEP`
		 * (file env wins over `options.file`; other explicit options beat env).
		 */
		withPinoRoll(options: PinoRollRecipeOptions): PinoRecipe;
		withPinoCustom<T extends string = never, CustomOnly extends true = undefined>(
			options?: CustomLevelOptions<T, CustomOnly>,
		): PinoLoggerFactory;
	}
	namespace scribe {
		function withPino(
			transports: TransportConfig | TransportConfig[],
			loglevel?: DefaultLevels | string,
		): PinoLoggerFactory;
		function withPinoPretty(
			logLevelOrOptions?: DefaultLevels | string | PinoPrettyRecipeOptions,
		): PinoRecipe;
		function withPinoRoll(options: PinoRollRecipeOptions): PinoRecipe;
		function withPinoCustom<T extends string = never, CustomOnly extends true = undefined>(
			options?: CustomLevelOptions<T, CustomOnly>,
		): PinoLoggerFactory;
	}
}

export class PinoExtensions {
	@extension(scribe, { static: true })
	public static withPino(
		factory: scribe,
		config: TransportConfig | TransportConfig[],
		logLevel?: DefaultLevels | string,
	) {
		return configureScribe(factory, logLevel != null ? { logLevel } : undefined, config);
	}

	@extension(scribe, { static: true })
	public static withPinoPretty(
		factory: scribe,
		logLevelOrOptions?: DefaultLevels | string | PinoPrettyRecipeOptions,
	) {
		const pretty = parsePrettyArg(logLevelOrOptions);
		return attachRecipe(factory, { pretty, logLevel: pretty.logLevel });
	}

	@extension(scribe, { static: true })
	public static withPinoRoll(factory: scribe, options: PinoRollRecipeOptions) {
		return attachRecipe(factory, { roll: options, logLevel: options.logLevel });
	}

	@extension(scribe, { static: true })
	public static withPinoCustom<T extends string = never, CustomOnly extends true = undefined>(
		factory: scribe,
		options?: CustomLevelOptions<T, CustomOnly>,
	) {
		const { scribe, transports } = options ?? {};
		return configureScribe(factory, scribe, transports);
	}
}

function parsePrettyArg(
	logLevelOrOptions?: DefaultLevels | string | PinoPrettyRecipeOptions,
): PinoPrettyRecipeOptions {
	if (logLevelOrOptions == null) {
		return {};
	}
	if (typeof logLevelOrOptions === "string") {
		return { logLevel: logLevelOrOptions };
	}
	return logLevelOrOptions;
}

function attachRecipe(factory: scribe, plan: PinoRecipePlan): PinoRecipe {
	const loggerFactory = applyRecipe(factory, plan);
	const chain: PinoRecipeChain = {
		withPinoPretty(logLevelOrOptions) {
			const pretty = parsePrettyArg(logLevelOrOptions);
			return attachRecipe(factory, {
				...plan,
				pretty: { ...plan.pretty, ...pretty },
				logLevel: pretty.logLevel ?? plan.logLevel,
			});
		},
		withPinoRoll(options) {
			return attachRecipe(factory, {
				...plan,
				roll: options,
				logLevel: options.logLevel ?? plan.logLevel,
			});
		},
	};
	return Object.assign(loggerFactory, chain, { and: chain });
}

/**
 * Guard a worker transport so failures (roll EEXIST, worker exit) neither
 * crash the process nor spam stderr on every subsequent log write.
 */
function createSafeTransport(options: TransportOptions): DestinationStream {
	return guardTransport(pino.transport(options));
}

function adapterForTransport(transport?: TransportOptions): PinoAdapter {
	if (transport == null) {
		return new PinoAdapter({});
	}
	return new PinoAdapter({}, createSafeTransport(transport));
}

function applyRecipe(factory: scribe, plan: PinoRecipePlan): PinoLoggerFactory {
	const adapter = adapterForTransport(pinoRecipe.transport(plan));
	// Omit logLevel when unset so mergeDefaults can read LOG_LEVEL / SCRIBE_LOG_LEVEL.
	return factory.configure({
		options: plan.logLevel != null ? { logLevel: plan.logLevel } : {},
		adapter,
	});
}

function configureScribe<T extends string = never, CustomOnly extends true | false = false>(
	factory: scribe,
	options: ScribeOptions<T, CustomOnly> | undefined,
	config?: TransportConfig | TransportConfig[],
) {
	const environment = process.env.NODE_ENV ?? DefaultEnvironment;
	const configs = (Array.isArray(config) ? config : config != null ? [config] : []).filter(
		(item) => item.environment == null || item.environment === environment,
	);

	if (configs.length > 1) {
		throw new LoggingConfigurationError(
			`There should only be one configuration per environment for logging`,
		);
	}

	const adapter = adapterForTransport(configs.at(0)?.transports);
	// Do not force DefaultLogLevel — that would shadow env resolution in mergeDefaults.
	return factory.configure({
		options: options ?? {},
		adapter,
	});
}

/** @deprecated Use {@link guardTransport} — kept for callers/tests from the silence-only era. */
function silenceErrors(transport: {
	on(event: "error", listener: (err: Error) => void): unknown;
	write?: (...args: never[]) => unknown;
}): GuardedTransport {
	return guardTransport(transport as DestinationStream);
}

export const pinoTransport = { createSafeTransport, guardTransport, silenceErrors };
