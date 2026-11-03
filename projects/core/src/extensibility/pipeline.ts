import { scribe } from "@decohere/scribe";

export interface PipelineStep<
	TContext extends Record<string, unknown> = Record<string, unknown>,
> {
	run(ctx: TContext, next: Next): Promise<void> | void;
}

export type Next = () => Promise<void> | void;
export class Pipeline<T extends Record<string, unknown>> {
	private readonly stack: [string, PipelineStep<T>, ((ctx: T) => boolean)?][];
	private readonly logger = scribe.logger(Pipeline.name);
	private currentStep: string | undefined;
	public constructor(...steps: [string, PipelineStep<T>, ((ctx: T) => boolean)?][]) {
		this.stack = steps;
	}

	public [Symbol.dispose]() {
		for (const [, step] of this.stack) {
			if (Symbol.dispose in step) {
				(step as Disposable)[Symbol.dispose]();
			}
		}
	}

	public async start(context: T) {
		const runStep = async (index: number): Promise<void> => {
			const [key, middleware, when] = this.stack[index] ?? [];
			if (middleware == null) {
				return;
			}

			if (when != null && !when(context)) {
				this.logger.info(`Skipping step ${key}`);
				return await runStep(index + 1);
			}

			this.currentStep = key;
			this.logger.info(`Running step ${key}`);
			await middleware.run(context, async () => {
				await runStep(index + 1);
			});
		};

		try {
			await runStep(0);
		} catch (error) {
			const step = this.currentStep ?? "unknown";
			if (error instanceof Error) {
				throw new Error(`Pipeline step '${step}' failed: ${error.message}`, {
					cause: error,
				});
			}

			throw new Error(`Pipeline step '${step}' failed with non-Error value`, {
				cause: error,
			});
		}
	}
}
