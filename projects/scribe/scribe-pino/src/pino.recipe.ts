import { type Environment, Environments } from "@decohere/core/system";
import type { TransportMultiOptions, TransportSingleOptions } from "pino";

/** Pretty and roll are local-dev conveniences. Production ships JSON on stdout. */
export type PinoWhen = "development" | "always";

export type PinoPrettyRecipeOptions = {
	colorize?: boolean;
	logLevel?: string;
	when?: PinoWhen;
};

export type PinoRollRecipeOptions = {
	/** Default roll path. Overridden at runtime by `SCRIBE_LOG_FILE` when set. */
	file: string;
	size?: string;
	frequency?: string | number;
	keep?: number;
	mkdir?: boolean;
	symlink?: boolean;
	logLevel?: string;
	when?: PinoWhen;
};

export type PinoRecipePlan = {
	pretty?: PinoPrettyRecipeOptions;
	roll?: PinoRollRecipeOptions;
	logLevel?: string;
};

const DEFAULT_ROLL_SIZE = "10m";
const DEFAULT_ROLL_FREQUENCY = "daily";
const DEFAULT_ROLL_KEEP = 14;

const ENV_LOG_FILE = "SCRIBE_LOG_FILE";
const ENV_LOG_SIZE = "SCRIBE_LOG_SIZE";
const ENV_LOG_FREQUENCY = "SCRIBE_LOG_FREQUENCY";
const ENV_LOG_KEEP = "SCRIBE_LOG_KEEP";

function currentEnvironment(): Environment {
	return process.env.NODE_ENV === Environments.production
		? Environments.production
		: Environments.development;
}

function isEnabled(when: PinoWhen | undefined, environment: Environment): boolean {
	return (when ?? "development") === "always" || environment === Environments.development;
}

function envString(name: string): string | undefined {
	const value = process.env[name]?.trim();
	return value ? value : undefined;
}

function envFrequency(): string | number | undefined {
	const raw = envString(ENV_LOG_FREQUENCY);
	if (raw == null) {
		return undefined;
	}
	if (/^\d+$/.test(raw)) {
		return Number(raw);
	}
	return raw;
}

function envKeep(): number | undefined {
	const raw = envString(ENV_LOG_KEEP);
	if (raw == null) {
		return undefined;
	}
	const keep = Number(raw);
	return Number.isFinite(keep) && keep >= 0 ? keep : undefined;
}

/**
 * Resolve roll options. `SCRIBE_LOG_FILE` overrides `file` so ops can redirect
 * without touching app code. Size / frequency / keep: explicit > env > default.
 */
function resolveRoll(options: PinoRollRecipeOptions): {
	file: string;
	size: string;
	frequency: string | number;
	keep: number;
	mkdir: boolean;
	symlink: boolean;
} {
	return {
		file: envString(ENV_LOG_FILE) ?? options.file,
		size: options.size ?? envString(ENV_LOG_SIZE) ?? DEFAULT_ROLL_SIZE,
		frequency: options.frequency ?? envFrequency() ?? DEFAULT_ROLL_FREQUENCY,
		keep: options.keep ?? envKeep() ?? DEFAULT_ROLL_KEEP,
		mkdir: options.mkdir ?? true,
		symlink: options.symlink ?? false,
	};
}

function prettyTarget(options: PinoPrettyRecipeOptions): TransportSingleOptions {
	return {
		target: "pino-pretty",
		options: { colorize: options.colorize ?? true },
	};
}

function rollTarget(options: PinoRollRecipeOptions): TransportSingleOptions {
	const roll = resolveRoll(options);
	return {
		target: "pino-roll",
		options: {
			file: roll.file,
			mkdir: roll.mkdir,
			size: roll.size,
			frequency: roll.frequency,
			limit: { count: roll.keep },
			symlink: roll.symlink,
		},
	};
}

function transport(
	plan: PinoRecipePlan,
	environment: Environment = currentEnvironment(),
): TransportSingleOptions | TransportMultiOptions | undefined {
	const targets: TransportSingleOptions[] = [];
	if (plan.pretty && isEnabled(plan.pretty.when, environment)) {
		targets.push(prettyTarget(plan.pretty));
	}
	if (plan.roll && isEnabled(plan.roll.when, environment)) {
		targets.push(rollTarget(plan.roll));
	}
	if (targets.length === 0) {
		return undefined;
	}
	if (targets.length === 1) {
		return targets[0];
	}
	return { targets };
}

export const pinoRecipe = { transport, currentEnvironment, resolveRoll };
