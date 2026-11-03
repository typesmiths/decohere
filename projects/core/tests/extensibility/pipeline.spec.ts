import { describe, expect, it, vi } from "vitest";
import { Pipeline, type PipelineStep } from "../../src/extensibility/pipeline.js";

type TestCtx = { log: string[] };

function makeStep(_name: string, sideEffect?: (ctx: TestCtx) => void): PipelineStep<TestCtx> {
	return {
		async run(ctx, next) {
			sideEffect?.(ctx);
			await next();
		},
	};
}

describe("Pipeline", () => {
	describe("step execution", () => {
		it("runs a single step", async () => {
			const ctx: TestCtx = { log: [] };
			const pipeline = new Pipeline<TestCtx>(["A", makeStep("A", (c) => c.log.push("A"))]);

			await pipeline.start(ctx);

			expect(ctx.log).toEqual(["A"]);
		});

		it("runs multiple steps in order", async () => {
			const ctx: TestCtx = { log: [] };
			const pipeline = new Pipeline<TestCtx>(
				["A", makeStep("A", (c) => c.log.push("A"))],
				["B", makeStep("B", (c) => c.log.push("B"))],
				["C", makeStep("C", (c) => c.log.push("C"))],
			);

			await pipeline.start(ctx);

			expect(ctx.log).toEqual(["A", "B", "C"]);
		});

		it("completes with no steps without error", async () => {
			const pipeline = new Pipeline<TestCtx>();
			await expect(pipeline.start({ log: [] })).resolves.toBeUndefined();
		});

		it("passes the same context object to every step", async () => {
			const ctx: TestCtx = { log: [] };
			const received: TestCtx[] = [];

			const capturingStep = (_name: string): PipelineStep<TestCtx> => ({
				async run(c, next) {
					received.push(c);
					await next();
				},
			});

			const pipeline = new Pipeline<TestCtx>(
				["A", capturingStep("A")],
				["B", capturingStep("B")],
			);
			await pipeline.start(ctx);

			expect(received).toHaveLength(2);
			expect(received[0]).toBe(ctx);
			expect(received[1]).toBe(ctx);
		});
	});

	describe("next() control flow", () => {
		it("stops at a step that does not call next()", async () => {
			const ctx: TestCtx = { log: [] };
			const blocker: PipelineStep<TestCtx> = {
				async run(c, _next) {
					c.log.push("blocker");
					// intentionally does not call next()
				},
			};
			const pipeline = new Pipeline<TestCtx>(
				["Blocker", blocker],
				["After", makeStep("After", (c) => c.log.push("After"))],
			);

			await pipeline.start(ctx);

			expect(ctx.log).toEqual(["blocker"]);
		});

		it("allows a step to do work after calling next() (onion model)", async () => {
			const ctx: TestCtx = { log: [] };
			const wrapStep: PipelineStep<TestCtx> = {
				async run(c, next) {
					c.log.push("before");
					await next();
					c.log.push("after");
				},
			};
			const pipeline = new Pipeline<TestCtx>(
				["Wrap", wrapStep],
				["Inner", makeStep("Inner", (c) => c.log.push("inner"))],
			);

			await pipeline.start(ctx);

			expect(ctx.log).toEqual(["before", "inner", "after"]);
		});
	});

	describe("step skip predicate (when)", () => {
		it("runs a step when `when` returns true", async () => {
			const ctx: TestCtx = { log: [] };
			const runSpy = vi.fn();
			const step = makeStep("A", (c) => {
				c.log.push("A");
				runSpy();
			});
			const pipeline = new Pipeline<TestCtx>(["A", step, () => true]);

			await pipeline.start(ctx);

			expect(runSpy).toHaveBeenCalledOnce();
			expect(ctx.log).toEqual(["A"]);
		});

		it("skips a step when `when` returns false", async () => {
			const ctx: TestCtx = { log: [] };
			const runSpy = vi.fn();
			const step = makeStep("A", () => runSpy());
			const pipeline = new Pipeline<TestCtx>(["A", step, () => false]);

			await pipeline.start(ctx);

			expect(runSpy).not.toHaveBeenCalled();
			expect(ctx.log).toEqual([]);
		});

		it("continues to downstream steps after a skipped step", async () => {
			const ctx: TestCtx = { log: [] };
			const pipeline = new Pipeline<TestCtx>(
				["A", makeStep("A", (c) => c.log.push("A"))],
				["B", makeStep("B", (c) => c.log.push("B")), () => false],
				["C", makeStep("C", (c) => c.log.push("C"))],
			);

			await pipeline.start(ctx);

			expect(ctx.log).toEqual(["A", "C"]);
		});

		it("evaluates `when` against the live context at run time", async () => {
			const ctx: TestCtx & { flag: boolean } = { log: [], flag: false };
			const toggle: PipelineStep<typeof ctx> = {
				async run(c, next) {
					c.flag = true;
					await next();
				},
			};
			const conditional = makeStep("Conditional", (c) => c.log.push("conditional"));
			const pipeline = new Pipeline<typeof ctx>(
				["Toggle", toggle],
				["Conditional", conditional, (c) => c.flag],
			);

			await pipeline.start(ctx);

			expect(ctx.log).toEqual(["conditional"]);
		});

		it("steps without a `when` predicate always run (backward compat)", async () => {
			const ctx: TestCtx = { log: [] };
			const pipeline = new Pipeline<TestCtx>(["A", makeStep("A", (c) => c.log.push("A"))]);

			await pipeline.start(ctx);

			expect(ctx.log).toEqual(["A"]);
		});
	});

	describe("error handling", () => {
		it("propagates errors thrown inside a step", async () => {
			const thrower: PipelineStep<TestCtx> = {
				async run(_c, _next) {
					throw new Error("step failed");
				},
			};
			const pipeline = new Pipeline<TestCtx>(["Thrower", thrower]);

			await expect(pipeline.start({ log: [] })).rejects.toThrow("step failed");
		});

		it("propagates errors from inner steps back through outer steps", async () => {
			const ctx: TestCtx = { log: [] };
			const outer: PipelineStep<TestCtx> = {
				async run(c, next) {
					try {
						await next();
					} catch {
						c.log.push("caught-by-outer");
						throw new Error("re-thrown");
					}
				},
			};
			const inner: PipelineStep<TestCtx> = {
				async run(_c, _next) {
					throw new Error("inner error");
				},
			};
			const pipeline = new Pipeline<TestCtx>(["Outer", outer], ["Inner", inner]);

			await expect(pipeline.start(ctx)).rejects.toThrow("re-thrown");
			expect(ctx.log).toEqual(["caught-by-outer"]);
		});

		it("does not suppress errors even when step has a finally block", async () => {
			const ctx: TestCtx = { log: [] };
			const step: PipelineStep<TestCtx> = {
				async run(c, next) {
					try {
						await next();
					} finally {
						c.log.push("finally");
					}
				},
			};
			const thrower: PipelineStep<TestCtx> = {
				async run(_c, _next) {
					throw new Error("boom");
				},
			};
			const pipeline = new Pipeline<TestCtx>(["Step", step], ["Thrower", thrower]);

			await expect(pipeline.start(ctx)).rejects.toThrow("boom");
			expect(ctx.log).toEqual(["finally"]);
		});
	});

	describe("async steps", () => {
		it("awaits async steps before proceeding", async () => {
			const ctx: TestCtx = { log: [] };
			const asyncStep: PipelineStep<TestCtx> = {
				async run(c, next) {
					await new Promise<void>((resolve) => setTimeout(resolve, 5));
					c.log.push("async");
					await next();
				},
			};
			const pipeline = new Pipeline<TestCtx>(
				["Async", asyncStep],
				["Sync", makeStep("Sync", (c) => c.log.push("sync"))],
			);

			await pipeline.start(ctx);

			expect(ctx.log).toEqual(["async", "sync"]);
		});
	});

	describe("dispose behavior", () => {
		it("pipeline[Symbol.dispose]() calls disposers on steps that have them", async () => {
			let disposedA = false;
			let disposedB = false;

			const stepA: PipelineStep<TestCtx> & Disposable = {
				async run(ctx, next) {
					ctx.log.push("A");
					await next();
				},
				[Symbol.dispose]() {
					disposedA = true;
				},
			};
			const stepB: PipelineStep<TestCtx> = {
				async run(ctx, next) {
					ctx.log.push("B");
					await next();
				},
			};
			const stepC: PipelineStep<TestCtx> & Disposable = {
				async run(ctx, next) {
					ctx.log.push("C");
					await next();
				},
				[Symbol.dispose]() {
					disposedB = true;
				},
			};

			const pipeline = new Pipeline<TestCtx>(["A", stepA], ["B", stepB], ["C", stepC]);
			await pipeline.start({ log: [] });

			expect(disposedA).toBe(false);
			expect(disposedB).toBe(false);

			pipeline[Symbol.dispose]();

			expect(disposedA).toBe(true);
			expect(disposedB).toBe(true);
		});

		it("does not call [Symbol.dispose]() when the step reference is popped from the stack", async () => {
			let disposed = false;

			class DisposableStep implements PipelineStep<TestCtx> {
				public async run(ctx: TestCtx, next: () => Promise<void>) {
					ctx.log.push("ran");
					await next();
				}

				public [Symbol.dispose]() {
					disposed = true;
				}
			}

			const step = new DisposableStep();
			const ctx: TestCtx = { log: [] };
			const pipeline = new Pipeline<TestCtx>(["Disposable", step]);

			await pipeline.start(ctx);
			expect(ctx.log).toEqual(["ran"]);

			// Simulate popping the step from the stack (dropping the Pipeline's reference)
			(pipeline as any).stack.length = 0;

			// [Symbol.dispose]() is NOT a GC finalizer — dropping the ref does not invoke it
			expect(disposed).toBe(false);
		});

		it("calls [Symbol.dispose]() only when explicitly invoked", async () => {
			let disposed = false;

			class DisposableStep implements PipelineStep<TestCtx> {
				public async run(ctx: TestCtx, next: () => Promise<void>) {
					ctx.log.push("ran");
					await next();
				}

				public [Symbol.dispose]() {
					disposed = true;
				}
			}

			const step = new DisposableStep();
			const pipeline = new Pipeline<TestCtx>(["Disposable", step]);

			await pipeline.start({ log: [] });

			(pipeline as any).stack.length = 0;
			expect(disposed).toBe(false);

			// Only an explicit call triggers the disposer
			step[Symbol.dispose]();
			expect(disposed).toBe(true);
		});

		it("calls [Symbol.dispose]() automatically when the 'using' keyword is in scope", async () => {
			let disposed = false;

			class DisposableStep implements PipelineStep<TestCtx> {
				public async run(ctx: TestCtx, next: () => Promise<void>) {
					ctx.log.push("ran");
					await next();
				}

				public [Symbol.dispose]() {
					disposed = true;
				}
			}

			const ctx: TestCtx = { log: [] };

			{
				using step = new DisposableStep();
				const pipeline = new Pipeline<TestCtx>(["Disposable", step]);
				await pipeline.start(ctx);
				expect(disposed).toBe(false); // not yet — block hasn't exited
			} // <-- [Symbol.dispose]() fires here automatically

			expect(ctx.log).toEqual(["ran"]);
			expect(disposed).toBe(true);
		});
	});
});
