import { describe, expect, it, vi } from "vitest";
import { retry } from "../../src/system/retry.decorator.js";

describe("retry decorator", () => {
	it("retries until success within attempt limit", async () => {
		class TestClass {
			private attempts = 0;

			@retry({ attempts: 3 })
			public async unstableOperation() {
				this.attempts++;
				if (this.attempts < 3) {
					throw new Error("transient");
				}
				return "ok";
			}
		}

		const instance = new TestClass();
		await expect(instance.unstableOperation()).resolves.toBe("ok");
	});

	it("throws after max attempts", async () => {
		class TestClass {
			@retry({ attempts: 2 })
			public async alwaysFails() {
				throw new Error("persistent");
			}
		}

		const instance = new TestClass();
		await expect(instance.alwaysFails()).rejects.toThrow("persistent");
	});

	it("respects shouldRetry predicate", async () => {
		const shouldRetry = vi.fn((error: unknown) => {
			return (error as Error).message !== "fatal";
		});

		class TestClass {
			private attempts = 0;

			@retry({ attempts: 5, shouldRetry })
			public async operation() {
				this.attempts++;
				if (this.attempts === 1) {
					throw new Error("fatal");
				}
				return "ok";
			}
		}

		const instance = new TestClass();
		await expect(instance.operation()).rejects.toThrow("fatal");
		expect(shouldRetry).toHaveBeenCalledTimes(1);
	});
});
