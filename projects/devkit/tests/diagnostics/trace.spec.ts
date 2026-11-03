import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.resetModules() clears Vitest's module registry so that the next dynamic
// import() re-evaluates trace.ts, picking up process.env.FORGE_TRACE into the
// module-level `const isTraceEnabled` at load time.
// vi.spyOn is set up after import — trace.ts calls scribe.logger() only when
// the decorator is applied (inside the test body), not at module evaluation time.
const importTrace = async () => {
	const [decorators, { scribe }] = await Promise.all([
		import("@decohere/devkit/diagnostics") as Promise<
			typeof import("@decohere/devkit/diagnostics")
		>,
		import("@decohere/scribe"),
	]);
	// Spy on the shared scribe object — same reference trace.ts holds.
	const loggerSpy = vi.spyOn(scribe, "logger").mockReturnValue({
		trace: vi.fn(),
		info: vi.fn(),
	} as never);
	return { ...decorators, loggerSpy };
};

describe("@timed decorator", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it("wraps the method when FORGE_TRACE is not set", async () => {
		const { timed } = await importTrace();
		class Subject {
			public myMethod() {
				return "result";
			}
		}
		const descriptor = Object.getOwnPropertyDescriptor(Subject.prototype, "myMethod")!;
		const original = descriptor.value;
		timed(Subject.prototype, "myMethod", descriptor);
		expect(descriptor.value).not.toBe(original);
		expect(descriptor.value.call(new Subject())).toBe("result");
	});

	it("logs timing at info for sync methods", async () => {
		const { timed, loggerSpy } = await importTrace();
		const infoFn = vi.fn();
		const traceFn = vi.fn();
		loggerSpy.mockReturnValue({ info: infoFn, trace: traceFn } as never);
		class Subject {
			public myMethod() {
				return "result";
			}
		}
		const descriptor = Object.getOwnPropertyDescriptor(Subject.prototype, "myMethod")!;
		timed(Subject.prototype, "myMethod", descriptor);
		descriptor.value.call(new Subject());
		expect(infoFn).toHaveBeenCalledWith(expect.stringMatching(/^myMethod\(.*\): [\d.]+ms$/));
		expect(traceFn).not.toHaveBeenCalled();
	});

	it("logs timing at info after async method resolves", async () => {
		const { timed, loggerSpy } = await importTrace();
		const infoFn = vi.fn();
		loggerSpy.mockReturnValue({ info: infoFn, trace: vi.fn() } as never);
		class Subject {
			public async myMethod() {
				return "result";
			}
		}
		const descriptor = Object.getOwnPropertyDescriptor(Subject.prototype, "myMethod")!;
		timed(Subject.prototype, "myMethod", descriptor);
		expect(await descriptor.value.call(new Subject())).toBe("result");
		expect(infoFn).toHaveBeenCalledWith(expect.stringMatching(/^myMethod\(.*\): [\d.]+ms$/));
	});

	it("logs timing at info even when async method rejects", async () => {
		const { timed, loggerSpy } = await importTrace();
		const infoFn = vi.fn();
		loggerSpy.mockReturnValue({ info: infoFn, trace: vi.fn() } as never);
		class Subject {
			public async myMethod() {
				throw new Error("boom");
			}
		}
		const descriptor = Object.getOwnPropertyDescriptor(Subject.prototype, "myMethod")!;
		timed(Subject.prototype, "myMethod", descriptor);
		await expect(descriptor.value.call(new Subject())).rejects.toThrow("boom");
		expect(infoFn).toHaveBeenCalledWith(expect.stringMatching(/^myMethod\(.*\): [\d.]+ms$/));
	});
});

describe("@trace / @Trace decorators", () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	describe("when FORGE_TRACE is not set", () => {
		it("trace: returns descriptor unchanged (no wrapping)", async () => {
			const { trace } = await importTrace();
			const fn = vi.fn().mockReturnValue("result");
			const descriptor = { value: fn };
			trace({} as object, "myMethod", descriptor as PropertyDescriptor);
			expect(descriptor.value).toBe(fn);
		});

		it("Trace: does not wrap class methods", async () => {
			const { Trace } = await importTrace();
			class Subject {
				public greet() {
					return "hi";
				}
			}
			const original = Subject.prototype.greet;
			Trace(Subject);
			expect(Subject.prototype.greet).toBe(original);
		});
	});

	describe("when FORGE_TRACE is set", () => {
		beforeEach(() => {
			vi.stubEnv("FORGE_TRACE", "1");
		});

		describe("trace (method decorator)", () => {
			it("replaces the descriptor value with a wrapper", async () => {
				const { trace } = await importTrace();
				const fn = vi.fn().mockReturnValue("result");
				class Subject {
					public myMethod() {
						return fn();
					}
				}
				const descriptor = Object.getOwnPropertyDescriptor(Subject.prototype, "myMethod")!;
				trace(Subject.prototype, "myMethod", descriptor);
				expect(descriptor.value).not.toBe(fn);
			});

			it("preserves sync return value", async () => {
				const { trace } = await importTrace();
				const fn = vi.fn().mockReturnValue("result");
				class Subject {
					public myMethod() {
						return fn();
					}
				}
				const descriptor = Object.getOwnPropertyDescriptor(Subject.prototype, "myMethod")!;
				trace(Subject.prototype, "myMethod", descriptor);
				expect(descriptor.value.call(new Subject())).toBe("result");
			});

			it("logs timing for sync methods", async () => {
				const { trace, loggerSpy } = await importTrace();
				const traceFn = vi.fn();
				loggerSpy.mockReturnValue({ trace: traceFn } as never);
				const fn = vi.fn().mockReturnValue("result");
				class Subject {
					public myMethod() {
						return fn();
					}
				}
				const descriptor = Object.getOwnPropertyDescriptor(Subject.prototype, "myMethod")!;
				trace(Subject.prototype, "myMethod", descriptor);
				descriptor.value.call(new Subject());
				expect(traceFn).toHaveBeenCalledWith(
					expect.stringMatching(/^myMethod\(.*\): [\d.]+ms$/),
				);
			});

			it("preserves async return value", async () => {
				const { trace } = await importTrace();
				const fn = vi.fn().mockResolvedValue("async-result");
				class Subject {
					public async myMethod() {
						return fn();
					}
				}
				const descriptor = Object.getOwnPropertyDescriptor(Subject.prototype, "myMethod")!;
				trace(Subject.prototype, "myMethod", descriptor);
				expect(await descriptor.value.call(new Subject())).toBe("async-result");
			});

			it("logs timing after async method resolves", async () => {
				const { trace, loggerSpy } = await importTrace();
				const traceFn = vi.fn();
				loggerSpy.mockReturnValue({ trace: traceFn } as never);
				const fn = vi.fn().mockResolvedValue("result");
				class Subject {
					public async myMethod() {
						return fn();
					}
				}
				const descriptor = Object.getOwnPropertyDescriptor(Subject.prototype, "myMethod")!;
				trace(Subject.prototype, "myMethod", descriptor);
				await descriptor.value.call(new Subject());
				expect(traceFn).toHaveBeenCalledWith(
					expect.stringMatching(/^myMethod\(.*\): [\d.]+ms$/),
				);
			});

			it("logs timing even when async method rejects", async () => {
				const { trace, loggerSpy } = await importTrace();
				const traceFn = vi.fn();
				loggerSpy.mockReturnValue({ trace: traceFn } as never);
				const fn = vi.fn().mockRejectedValue(new Error("boom"));
				class Subject {
					public async myMethod() {
						return fn();
					}
				}
				const descriptor = Object.getOwnPropertyDescriptor(Subject.prototype, "myMethod")!;
				trace(Subject.prototype, "myMethod", descriptor);
				await expect(descriptor.value.call(new Subject())).rejects.toThrow("boom");
				expect(traceFn).toHaveBeenCalledWith(
					expect.stringMatching(/^myMethod\(.*\): [\d.]+ms$/),
				);
			});
		});

		describe("Trace (class decorator)", () => {
			it("wraps all methods on the prototype", async () => {
				const { Trace } = await importTrace();
				class Subject {
					public methodA() {
						return "a";
					}
					public methodB() {
						return "b";
					}
				}
				const originalA = Subject.prototype.methodA;
				const originalB = Subject.prototype.methodB;
				Trace(Subject);
				expect(Subject.prototype.methodA).not.toBe(originalA);
				expect(Subject.prototype.methodB).not.toBe(originalB);
			});

			it("does not wrap the constructor", async () => {
				const { Trace } = await importTrace();
				const ctorSpy = vi.fn();
				class Subject {
					public constructor() {
						ctorSpy();
					}
				}
				expect(() => Trace(Subject)).not.toThrow();
				new Subject();
				expect(ctorSpy).toHaveBeenCalledOnce();
			});

			it("preserves method return values after wrapping", async () => {
				const { Trace } = await importTrace();
				class Subject {
					public greet(name: string) {
						return `hello ${name}`;
					}
				}
				Trace(Subject);
				expect(new Subject().greet("world")).toBe("hello world");
			});

			it("logs timing for each method call", async () => {
				const { Trace, loggerSpy } = await importTrace();
				const traceFn = vi.fn();
				loggerSpy.mockReturnValue({ trace: traceFn } as never);
				class Subject {
					public methodA() {
						return "a";
					}
					public methodB() {
						return "b";
					}
				}
				Trace(Subject);
				const instance = new Subject();
				instance.methodA();
				instance.methodB();
				expect(traceFn.mock.calls).toHaveLength(2);
			});
		});
	});
});

describe("importing @decohere/devkit/diagnostics", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it("leaves scribe alone even with FORGE_TRACE set: a library has no side effects on import", async () => {
		vi.resetModules();
		vi.stubEnv("FORGE_TRACE", "1");
		const { scribe } = await import("@decohere/scribe");
		const configure = vi.spyOn(scribe, "configure");

		await import("@decohere/devkit/diagnostics");

		expect(configure).not.toHaveBeenCalled();
	});

	it("reads FORGE_TRACE when a method is decorated, not when the module loads", async () => {
		vi.resetModules();
		const { trace } = await importTrace();
		vi.stubEnv("FORGE_TRACE", "1");
		const fn = vi.fn();
		const descriptor = { value: fn };

		trace({} as object, "myMethod", descriptor as PropertyDescriptor);

		expect(descriptor.value).not.toBe(fn);
	});
});
