import type { Project } from "@decohere/workspace";
import type { File } from "@decohere/core/io";
import type { BuildTarget } from "./build-target.type.js";

export type TransformOutcome = "success" | "failure" | "skipped";

type TransformResponseBase = {
	file: File;
	config: unknown;
	project?: Project;
	/** Absolute directory that will contain the output file. Pre-computed by the transformer. */
	outputDir?: string;
	/** Absolute path of the output file (outputDir + fileName). Pre-computed by the transformer. */
	outputPath?: string;
};

type TransformSuccess = TransformResponseBase & {
	outcome: "success";
	code: string;
	sourceContent?: string;
	messages?: string[];
	target: BuildTarget;
	fileName: string;
};

type TransformFailure = TransformResponseBase & {
	outcome: "failure";
	messages?: string[];
	target?: BuildTarget;
	fileName?: string;
};

type TransformSkipped = TransformResponseBase & {
	outcome: "skipped";
	messages?: string | string[];
};

type TransformResponseData<T extends TransformOutcome = TransformOutcome> = T extends "success"
	? TransformSuccess
	: T extends "skipped"
		? TransformSkipped
		: TransformFailure;

export class TransformResponse {
	public static Success(data: Omit<TransformResponseData<"success">, "outcome">) {
		return new TransformResponse({ ...data, outcome: "success" as const });
	}

	public static Error(data: Omit<TransformResponseData<"failure">, "outcome">) {
		return new TransformResponse({ ...data, outcome: "failure" as const });
	}

	public static Skipped(data: Omit<TransformResponseData<"skipped">, "outcome">) {
		return new TransformResponse({ ...data, outcome: "skipped" as const });
	}

	public static from(data: TransformResponseData): TransformResponse {
		return new TransformResponse({ ...data } as TransformResponseData);
	}

	public constructor(data?: Partial<TransformResponseData>) {
		Object.assign(this, data);
	}

	// Properties are populated via Object.assign in the constructor.
	public readonly file!: File;
	public readonly outcome!: TransformOutcome;
	public readonly target?: BuildTarget;
	public readonly code!: string;
	public readonly sourceContent?: string;
	public readonly fileName?: string;
	public readonly messages?: string[];
	public readonly config: unknown;
	public readonly project?: Project;
	public readonly outputDir?: string;
	public readonly outputPath?: string;
}
