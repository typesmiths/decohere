import { describe, expect, it, vi } from "vitest";
import { ConsoleAdapter } from "../src/console.adapter.js";
import { scribe } from "../src/logger.factory.js";

describe("Console Adapter", () => {
	it("should work without configuration", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		const logger = scribe.logger("test");
		logger.info("Hello world");

		expect(spy).toHaveBeenCalledWith(
			expect.stringMatching(
				/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\] INFO \[test\]: Hello world/,
			),
		);

		spy.mockRestore();
	});

	it("should support all log levels when configured at trace", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		const loggerFactory = scribe.configure({
			adapter: new ConsoleAdapter(),
			options: { logLevel: "trace" },
		});
		const logger = loggerFactory("test");

		logger.fatal("Fatal message");
		logger.error("Error message");
		logger.warn("Warning message");
		logger.info("Info message");
		logger.debug("Debug message");
		logger.trace("Trace message");

		expect(spy).toHaveBeenCalledTimes(6);
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("FATAL"));
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("ERROR"));
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("WARN"));
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("INFO"));
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("DEBUG"));
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("TRACE"));

		spy.mockRestore();
	});

	it("should filter logs below the configured level", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		const loggerFactory = scribe.configure({
			adapter: new ConsoleAdapter(),
			options: { logLevel: "warn" },
		});
		const logger = loggerFactory("test");

		logger.fatal("Fatal message");
		logger.error("Error message");
		logger.warn("Warning message");
		logger.info("Info message");
		logger.debug("Debug message");
		logger.trace("Trace message");

		// Only fatal (60), error (50), warn (40) are >= warn threshold (40)
		expect(spy).toHaveBeenCalledTimes(3);
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("FATAL"));
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("ERROR"));
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("WARN"));

		spy.mockRestore();
	});

	it("should have logger properties", () => {
		const loggerFactory = scribe.configure({
			adapter: new ConsoleAdapter(),
			options: { logLevel: "info" },
		});
		const logger = loggerFactory("test");

		expect(logger.currentLevel).toBe("info");
		expect(logger.logLevels).toBeDefined();
		expect(logger.isLevelEnabled("info")).toBe(true);
		expect(logger.isLevelEnabled("debug")).toBe(false);
		expect(logger.isLevelEnabled("warn")).toBe(true);
	});

	it("logs the error message when passed an Error object", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		const loggerFactory = scribe.configure({
			adapter: new ConsoleAdapter(),
			options: { logLevel: "error" },
		});
		const logger = loggerFactory("test");

		logger.error(new Error("something went wrong"));

		expect(spy).toHaveBeenCalledWith(expect.stringContaining("something went wrong"));

		spy.mockRestore();
	});
});
