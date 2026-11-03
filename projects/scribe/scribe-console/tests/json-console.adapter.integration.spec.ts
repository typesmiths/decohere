/**
 * JSON console adapter through the public API (`scribe.configure` / `scribe.logger`):
 * one JSON line per entry, through the console method of its level.
 */
import { scribe } from "@decohere/scribe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { JsonConsoleAdapter } from "../src/json-console.adapter.js";

afterEach(async () => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	await scribe.stop();
});

type Method = "error" | "warn" | "info" | "debug" | "log";

/** Lines per console method, parsed. */
function captureConsole(): Record<Method, Record<string, unknown>[]> {
	const lines: Record<Method, Record<string, unknown>[]> = {
		error: [],
		warn: [],
		info: [],
		debug: [],
		log: [],
	};
	for (const method of Object.keys(lines) as Method[]) {
		vi.spyOn(console, method).mockImplementation((line: string) => {
			lines[method].push(JSON.parse(line) as Record<string, unknown>);
		});
	}
	return lines;
}

describe("JsonConsoleAdapter", () => {
	it("writes { level, name, msg, ...fields } through the method of each level", () => {
		const lines = captureConsole();
		scribe.configure({ adapter: new JsonConsoleAdapter(), options: { logLevel: "trace" } });
		const log = scribe.logger("Worker");
		log.fatal("down");
		log.error("failed");
		log.warn("slow", { ms: 900 });
		log.info("ready");
		log.debug("cache miss");
		log.trace("step");

		expect(lines.error).toEqual([
			{ level: "fatal", name: "Worker", msg: "down" },
			{ level: "error", name: "Worker", msg: "failed" },
		]);
		expect(lines.warn).toEqual([{ level: "warn", name: "Worker", msg: "slow", ms: 900 }]);
		expect(lines.info).toEqual([{ level: "info", name: "Worker", msg: "ready" }]);
		expect(lines.debug).toEqual([
			{ level: "debug", name: "Worker", msg: "cache miss" },
			{ level: "trace", name: "Worker", msg: "step" },
		]);
		expect(lines.log).toEqual([]);
	});

	it("filters below the configured level", () => {
		const lines = captureConsole();
		scribe.configure({ adapter: new JsonConsoleAdapter(), options: { logLevel: "warn" } });
		scribe.logger("Worker").info("hidden");
		expect(lines.info).toEqual([]);
	});

	it("routes custom levels by their value", () => {
		const lines = captureConsole();
		scribe.configure({
			adapter: new JsonConsoleAdapter(),
			options: { logLevel: "trace", customLevels: { audit: 45, metric: 25 } },
		});
		const log = scribe.logger<"audit" | "metric">("Billing");
		log.audit("sealed");
		log.metric("latency", { ms: 12 });
		expect(lines.warn).toEqual([{ level: "audit", name: "Billing", msg: "sealed" }]);
		expect(lines.debug).toEqual([
			{ level: "metric", name: "Billing", msg: "latency", ms: 12 },
		]);
	});

	it("writes errors with their causes, and child fields", () => {
		const lines = captureConsole();
		scribe.configure({ adapter: new JsonConsoleAdapter() });
		const err = new Error("fetch failed", { cause: new Error("connection reset") });
		scribe.logger("Http").child({ requestId: "r-1" }).error("upstream failed", err);

		expect(lines.error).toEqual([
			{
				level: "error",
				name: "Http",
				msg: "upstream failed",
				requestId: "r-1",
				err: {
					name: "Error",
					message: "fetch failed",
					stack: expect.stringContaining("Error: fetch failed"),
					cause: {
						name: "Error",
						message: "connection reset",
						stack: expect.stringContaining("Error: connection reset"),
					},
				},
			},
		]);
	});

	it("keeps level and name from fields, and survives cycles and bigints", () => {
		const lines = captureConsole();
		scribe.configure({ adapter: new JsonConsoleAdapter() });
		const loop: Record<string, unknown> = { id: 1 };
		loop.self = loop;
		const err = Object.assign(new Error("odd"), { self: undefined as unknown });
		err.self = err;
		scribe.logger("Odd").info("probe", { level: "fake", name: "fake", loop, big: 10n, err });

		expect(lines.info).toEqual([
			{
				level: "info",
				name: "Odd",
				msg: "probe",
				loop: { id: 1, self: "[Circular]" },
				big: "10",
				err: expect.objectContaining({ message: "odd" }),
			},
		]);
	});

	it("adds time when asked", () => {
		const lines = captureConsole();
		scribe.configure({ adapter: new JsonConsoleAdapter({ timestamp: true }) });
		scribe.logger("Clock").info("tick");
		expect(lines.info[0].time).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
	});

	it("censors the redaction keys", () => {
		const lines = captureConsole();
		scribe.configure({ adapter: new JsonConsoleAdapter() });
		scribe.logger("Auth").info("login", { auth: { token: "t-659" } });
		expect(lines.info).toEqual([
			{ level: "info", name: "Auth", msg: "login", auth: { token: "[Redacted]" } },
		]);
	});

	/** The point of the package: no Node globals at all. */
	it("runs where there is no process global", () => {
		const lines = captureConsole();
		vi.stubGlobal("process", undefined);
		try {
			scribe.configure({ adapter: new JsonConsoleAdapter() });
			scribe.logger("Browser").info("ready");
		} finally {
			vi.unstubAllGlobals();
		}
		expect(lines.info).toEqual([{ level: "info", name: "Browser", msg: "ready" }]);
	});
});
