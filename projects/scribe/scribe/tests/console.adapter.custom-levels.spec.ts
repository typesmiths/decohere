import { describe, expect, it, vi } from "vitest";
import { ConsoleAdapter } from "../src/console.adapter.js";
import { scribe } from "../src/logger.factory.js";

describe("Console Adapter Custom Levels", () => {
	it("should support custom log levels", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		const customLevels = {
			custom: 100,
			debug2: 25,
		};

		// Use trace level so all custom levels (including debug2: 25) are enabled
		const loggerFactory = scribe.configure({
			adapter: new ConsoleAdapter(),
			options: { logLevel: "trace", customLevels },
		});
		const logger = loggerFactory("test");

		// Test custom level methods exist and work
		expect(typeof logger.custom).toBe("function");
		expect(typeof logger.debug2).toBe("function");

		logger.custom("Custom level message");
		logger.debug2("Debug2 level message");

		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("CUSTOM [test]: Custom level message"),
		);
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("DEBUG2 [test]: Debug2 level message"),
		);

		spy.mockRestore();
	});

	it("should include custom levels in logLevels property", () => {
		const customLevels = {
			custom: 100,
			special: 15,
		};

		const logger = scribe.logger("test", customLevels);

		const logLevels = logger.logLevels;

		// Should include default levels
		expect(logLevels.fatal).toBe(60);
		expect(logLevels.error).toBe(50);
		expect(logLevels.info).toBe(30);

		// Should include custom levels
		expect(logLevels.custom).toBe(100);
		expect(logLevels.special).toBe(15);
	});

	it("should work without custom levels (backwards compatibility)", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		const logger = scribe.logger("test");

		logger.info("Regular message");
		logger.error("Error message");

		expect(spy).toHaveBeenCalledWith(expect.stringContaining("INFO [test]: Regular message"));
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("ERROR [test]: Error message"));

		spy.mockRestore();
	});

	it("should override default levels with custom levels", () => {
		const customLevels = {
			info: 999, // Override default info level
			newLevel: 50,
		};

		const logger = scribe.logger("test", customLevels);

		const logLevels = logger.logLevels;

		// Custom level should override default
		expect(logLevels.info).toBe(999);
		expect(logLevels.newLevel).toBe(50);

		// Other defaults should remain
		expect(logLevels.fatal).toBe(60);
		expect(logLevels.error).toBe(50);
	});
});
