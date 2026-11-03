import { afterEach, describe, expect, it, vi } from "vitest";
import { cliLogLevel } from "../src/log-level.js";

describe("cliLogLevel: the level the bins log at", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	function clearLevelEnv() {
		for (const name of ["LOG_LEVEL", "SCRIBE_LOG_LEVEL", "LOGGING_LEVEL", "FORGE_TRACE"]) {
			vi.stubEnv(name, undefined);
		}
	}

	it("uses --log-level when given", () => {
		clearLevelEnv();
		vi.stubEnv("FORGE_TRACE", "1");
		expect(cliLogLevel("warn")).toBe("warn");
	});

	it("uses a level from the environment before FORGE_TRACE", () => {
		clearLevelEnv();
		vi.stubEnv("LOG_LEVEL", "debug");
		vi.stubEnv("FORGE_TRACE", "1");
		expect(cliLogLevel()).toBe("debug");
	});

	it("logs at trace when FORGE_TRACE is set and nothing else says otherwise", () => {
		clearLevelEnv();
		vi.stubEnv("FORGE_TRACE", "1");
		expect(cliLogLevel()).toBe("trace");
	});

	it("falls back to scribe's default level", async () => {
		clearLevelEnv();
		const { DefaultLogLevel } = await import("@decohere/scribe");
		expect(cliLogLevel()).toBe(DefaultLogLevel);
	});
});
