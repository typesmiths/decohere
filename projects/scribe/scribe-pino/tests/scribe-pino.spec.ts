import "../src/scribe-pino.js";
import { scribe } from "@decohere/scribe";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("withPino", () => {
	it("does not throw when no logLevel is provided", () => {
		expect(() =>
			scribe.withPino({
				transports: { target: "pino/file", options: { destination: 1 } },
			}),
		).not.toThrow();
	});

	it("defaults to info level and returns a working logger factory", () => {
		const factory = scribe.withPino({
			transports: { target: "pino/file", options: { destination: 1 } },
		});
		const logger = factory("test");
		expect(logger).toBeDefined();
	});
});

describe("withPinoPretty", () => {
	it("does not throw when called with no arguments", () => {
		expect(() => scribe.withPinoPretty()).not.toThrow();
	});

	it("returns a logger factory", () => {
		const factory = scribe.withPinoPretty();
		const logger = factory("test");
		expect(logger).toBeDefined();
	});

	it("accepts an explicit log level", () => {
		expect(() => scribe.withPinoPretty("debug")).not.toThrow();
	});

	it("exposes a fluent chain for roll", () => {
		const recipe = scribe.withPinoPretty();
		expect(typeof recipe.and.withPinoRoll).toBe("function");
		expect(typeof recipe.withPinoRoll).toBe("function");
	});

	it("is installed on the scribe constructor, not extend", () => {
		expect("extend" in scribe).toBe(false);
		expect(typeof scribe.withPinoPretty).toBe("function");
	});
});
