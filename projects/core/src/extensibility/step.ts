import type { Constructable } from "../reflection/index.js";
import type { PipelineStep } from "./pipeline.js";

/**
 * Wraps a pipeline step with an optional `when` predicate.
 * When `when` is provided, the step only runs if `when(ctx)` returns `true`.
 * If `when` returns `false`, the pipeline logs `"Skipping step <name>"` and
 * advances to the next step without invoking `run()`.
 *
 * Predicates are declared in the command constructor via `addDisableStepOption`,
 * keeping skip conditions co-located with the option that controls them.
 */
export class Step<T extends Record<string, unknown> = Record<string, unknown>> {
	public constructor(
		public readonly type: Constructable<PipelineStep<T>>,
		public readonly when?: (ctx: T) => boolean,
	) {}
}
