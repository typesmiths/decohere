import type {
	TransportMultiOptions,
	TransportPipelineOptions,
	TransportSingleOptions,
} from "pino";

export type PinoTransport =
	TransportSingleOptions | TransportMultiOptions | TransportPipelineOptions;

export type PinoPrettyOptions = {
	/** Colours in the output. Default `true`. */
	colorize?: boolean;
};

export type PinoRollOptions = {
	/** The log file. pino-roll adds a number to it on each roll. */
	file: string;
	/** Roll when the file reaches this size. Default `"10m"`. */
	size?: string;
	/** Roll on this schedule (`"daily"`, `"hourly"`) or every this many milliseconds. Default `"daily"`. */
	frequency?: string | number;
	/** How many rolled files to keep. Default `14`. */
	keep?: number;
	/** Create the file's folder. Default `true`. */
	mkdir?: boolean;
	/** Keep a `current.log` link to the newest file. Default `false`: it can race when several processes roll. */
	symlink?: boolean;
};

/** Where Pino writes, other than stdout: pretty lines, rolling files, or both. */
export class PinoTargets {
	public constructor(
		private readonly pretty: PinoPrettyOptions | undefined,
		private readonly roll: PinoRollOptions | undefined,
	) {}

	/** The Pino transport for these targets, or `undefined` for none (JSON on stdout). */
	public get transport(): TransportSingleOptions | TransportMultiOptions | undefined {
		const targets: TransportSingleOptions[] = [];
		if (this.pretty != null) targets.push(this.prettyTarget(this.pretty));
		if (this.roll != null) targets.push(this.rollTarget(this.roll));
		if (targets.length === 0) return undefined;
		if (targets.length === 1) return targets[0];
		return { targets };
	}

	private prettyTarget(pretty: PinoPrettyOptions): TransportSingleOptions {
		return { target: "pino-pretty", options: { colorize: pretty.colorize ?? true } };
	}

	private rollTarget(roll: PinoRollOptions): TransportSingleOptions {
		return {
			target: "pino-roll",
			options: {
				file: roll.file,
				mkdir: roll.mkdir ?? true,
				size: roll.size ?? "10m",
				frequency: roll.frequency ?? "daily",
				limit: { count: roll.keep ?? 14 },
				symlink: roll.symlink ?? false,
			},
		};
	}
}
