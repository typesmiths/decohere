import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConsoleAdapter } from "../src/console.adapter.js";
import {
	getLogLevelFromArgv,
	getLogLevelFromEnv,
	isValidLogLevel,
	resolveLogLevel,
} from "../src/env.js";
import { scribe } from "../src/logger.factory.js";

describe("getLogLevelFromArgv", () => {
	it("reads long-form flag with separate value", () => {
		expect(getLogLevelFromArgv(["node", "cli.js", "--log-level", "trace"])).toBe("trace");
	});

	it("reads short-form flag with separate value", () => {
		expect(getLogLevelFromArgv(["node", "cli.js", "-l", "debug"])).toBe("debug");
	});

	it("reads equals-form flag", () => {
		expect(getLogLevelFromArgv(["node", "cli.js", "--log-level=warn"])).toBe("warn");
	});

	it("returns undefined when flag is absent", () => {
		expect(getLogLevelFromArgv(["node", "cli.js", "build"])).toBeUndefined();
	});
});

describe("getLogLevelFromEnv", () => {
	beforeEach(() => {
		vi.stubEnv("LOG_LEVEL", undefined);
		vi.stubEnv("SCRIBE_LOG_LEVEL", undefined);
		vi.stubEnv("LOGGING_LEVEL", undefined);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("returns null when no env vars are set", () => {
		expect(getLogLevelFromEnv()).toBeNull();
	});

	it("reads LOG_LEVEL", () => {
		vi.stubEnv("LOG_LEVEL", "debug");
		expect(getLogLevelFromEnv()).toBe("debug");
	});

	it("reads SCRIBE_LOG_LEVEL", () => {
		vi.stubEnv("SCRIBE_LOG_LEVEL", "warn");
		expect(getLogLevelFromEnv()).toBe("warn");
	});

	it("reads LOGGING_LEVEL", () => {
		vi.stubEnv("LOGGING_LEVEL", "error");
		expect(getLogLevelFromEnv()).toBe("error");
	});

	it("LOG_LEVEL takes precedence over SCRIBE_LOG_LEVEL", () => {
		vi.stubEnv("LOG_LEVEL", "fatal");
		vi.stubEnv("SCRIBE_LOG_LEVEL", "trace");
		expect(getLogLevelFromEnv()).toBe("fatal");
	});

	it("SCRIBE_LOG_LEVEL takes precedence over LOGGING_LEVEL", () => {
		vi.stubEnv("SCRIBE_LOG_LEVEL", "debug");
		vi.stubEnv("LOGGING_LEVEL", "error");
		expect(getLogLevelFromEnv()).toBe("debug");
	});

	it("normalises to lowercase", () => {
		vi.stubEnv("LOG_LEVEL", "DEBUG");
		expect(getLogLevelFromEnv()).toBe("debug");
	});

	it("trims whitespace", () => {
		vi.stubEnv("LOG_LEVEL", "  info  ");
		expect(getLogLevelFromEnv()).toBe("info");
	});

	it("treats empty string as not set and falls through to next var", () => {
		vi.stubEnv("LOG_LEVEL", "");
		vi.stubEnv("SCRIBE_LOG_LEVEL", "warn");
		expect(getLogLevelFromEnv()).toBe("warn");
	});

	it("returns null when all vars are empty", () => {
		vi.stubEnv("LOG_LEVEL", "");
		vi.stubEnv("SCRIBE_LOG_LEVEL", "");
		vi.stubEnv("LOGGING_LEVEL", "");
		expect(getLogLevelFromEnv()).toBeNull();
	});
});

describe("isValidLogLevel", () => {
	it.each(["fatal", "error", "warn", "info", "debug", "trace"])(
		"returns true for valid level '%s'",
		(level) => {
			expect(isValidLogLevel(level)).toBe(true);
		},
	);

	it("returns false for unknown level", () => {
		expect(isValidLogLevel("verbose")).toBe(false);
	});

	it("returns false for empty string", () => {
		expect(isValidLogLevel("")).toBe(false);
	});
});

describe("resolveLogLevel", () => {
	beforeEach(() => {
		vi.stubEnv("LOG_LEVEL", undefined);
		vi.stubEnv("SCRIBE_LOG_LEVEL", undefined);
		vi.stubEnv("LOGGING_LEVEL", undefined);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("uses explicit log level when valid", () => {
		expect(resolveLogLevel("debug")).toBe("debug");
	});

	it("uses env log level when explicit is missing", () => {
		vi.stubEnv("LOG_LEVEL", "warn");
		expect(resolveLogLevel()).toBe("warn");
	});

	it("returns null when explicit and env are invalid using simple form", () => {
		vi.stubEnv("LOG_LEVEL", "verbose");
		expect(resolveLogLevel("nope")).toBeNull();
	});

	it("falls back to default when explicit and env are invalid using object form", () => {
		expect(
			resolveLogLevel({
				explicitLogLevel: "verbose",
				envLogLevel: "nope",
				defaultLogLevel: "info",
			}),
		).toBe("info");
	});
});

describe("scribe logger factory — env var log level", () => {
	beforeEach(() => {
		vi.stubEnv("LOG_LEVEL", undefined);
		vi.stubEnv("SCRIBE_LOG_LEVEL", undefined);
		vi.stubEnv("LOGGING_LEVEL", undefined);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("falls back to 'info' when no env var and no explicit logLevel", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		const loggerFn = scribe.configure({ adapter: new ConsoleAdapter() });
		const logger = loggerFn("env-test");

		logger.debug("should not appear");
		expect(spy).not.toHaveBeenCalledWith(expect.stringContaining("DEBUG"));

		logger.info("should appear");
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("INFO"));

		spy.mockRestore();
	});

	it("uses SCRIBE_LOG_LEVEL env var when no explicit logLevel", () => {
		vi.stubEnv("SCRIBE_LOG_LEVEL", "debug");
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		const loggerFn = scribe.configure({ adapter: new ConsoleAdapter() });
		const logger = loggerFn("env-debug-test");

		logger.debug("should appear via env var");
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("DEBUG"));

		spy.mockRestore();
	});

	it("explicit logLevel overrides env var", () => {
		vi.stubEnv("SCRIBE_LOG_LEVEL", "debug");
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		const loggerFn = scribe.configure({
			adapter: new ConsoleAdapter(),
			options: { logLevel: "error" },
		});
		const logger = loggerFn("explicit-override-test");

		logger.debug("should NOT appear");
		expect(spy).not.toHaveBeenCalledWith(expect.stringContaining("DEBUG"));

		logger.error("should appear");
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("ERROR"));

		spy.mockRestore();
	});
});
