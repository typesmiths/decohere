/**
 * Facade behavior through the public API (`scribe.logger` / `scribe.configure`).
 *
 * Scribe’s surface is small; these tests lock observable outcomes (console lines,
 * level, late-configure).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleAdapter } from "../src/console.adapter.js";
import type { LogEntry } from "../src/log-entry.js";
import { serializeError } from "../src/logger.adapter.js";
import { scribe } from "../src/logger.factory.js";
import { CaptureAdapter } from "../src/testing/index.js";

afterEach(async () => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	await scribe.stop();
});

describe("scribe facade (console)", () => {
	it("logs named info lines by default", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		scribe.logger("Orders").info("ready");
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("INFO [Orders]: ready"));
	});

	it("honors SCRIBE_LOG_LEVEL when configure omits logLevel", () => {
		vi.stubEnv("SCRIBE_LOG_LEVEL", "debug");
		scribe.configure({ adapter: new ConsoleAdapter() });
		const log = scribe.logger("Env");
		expect(log.currentLevel).toBe("debug");
		expect(log.isLevelEnabled("debug")).toBe(true);
	});

	it("filters below the configured level", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		scribe.configure({
			adapter: new ConsoleAdapter(),
			options: { logLevel: "warn" },
		});
		const log = scribe.logger("Filter");
		log.info("hidden");
		log.warn("shown");
		expect(spy).not.toHaveBeenCalledWith(expect.stringContaining("hidden"));
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("WARN [Filter]: shown"));
	});

	/**
	 * ConsoleAdapter bakes level into methods at create time.
	 * Module-level `const log = scribe.logger(...)` should pick up a later configure
	 * that raises the threshold (CLI / Flux / HotReloadServer pattern).
	 */
	it("late configure updates already-created logger methods", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		scribe.configure({
			adapter: new ConsoleAdapter(),
			options: { logLevel: "error" },
		});
		const log = scribe.logger("Early");
		log.info("before");
		expect(spy).not.toHaveBeenCalled();

		scribe.configure({
			adapter: new ConsoleAdapter(),
			options: { logLevel: "info" },
		});
		log.info("after-reconfigure");

		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("INFO [Early]: after-reconfigure"),
		);
	});

	/**
	 * Invalid explicit levels should fall back to env/default, not stick.
	 */
	it("rejects invalid explicit logLevel instead of installing it", () => {
		scribe.configure({
			adapter: new ConsoleAdapter(),
			options: { logLevel: "nope" as never },
		});
		expect(scribe.logger("Bad").currentLevel).toBe("info");
	});

	/**
	 * Browsers have no `process`; Workers without `nodejs_compat` neither.
	 * Configuring and logging must not reach for it.
	 */
	it("configures and logs where there is no process global", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		vi.stubGlobal("process", undefined);
		try {
			const fresh = new scribe();
			fresh.getLogger("Browser").info("ready");
			scribe.configure({ adapter: new ConsoleAdapter() });
			scribe.logger("Browser").warn("configured");
		} finally {
			vi.unstubAllGlobals();
		}
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("[scribe] No logger adapter configured"),
		);
		expect(log).toHaveBeenCalledWith(expect.stringContaining("INFO [Browser]: ready"));
		expect(log).toHaveBeenCalledWith(expect.stringContaining("WARN [Browser]: configured"));
	});

	it("redacts password, secret, token, otp, pw, and userconfig on object fields", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		scribe.logger("Secrets").info("probe", {
			password: "field-password-redact-me",
			token: "field-token-redact-me",
			otp: "field-otp-redact-me",
			nested: {
				secret: "field-secret-redact-me",
				pw: "field-pw-redact-me",
				userconfig: "field-userconfig-redact-me",
			},
		});
		const dumped = spy.mock.calls
			.map((call) =>
				call
					.map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg)))
					.join(" "),
			)
			.join("\n");
		for (const leak of [
			"field-password-redact-me",
			"field-token-redact-me",
			"field-otp-redact-me",
			"field-secret-redact-me",
			"field-pw-redact-me",
			"field-userconfig-redact-me",
		]) {
			expect(dumped).not.toContain(leak);
		}
		expect(dumped).toContain("[Redacted]");
	});
});

/** Structured entries: capture adapter, child, tap, errors, redaction. */
describe("scribe facade (structured entries)", () => {
	it("captures entries at or above the level and prints nothing", () => {
		const log = vi.spyOn(console, "log");
		const capture = new CaptureAdapter();
		scribe.configure({ adapter: capture, options: { logLevel: "info" } });
		const orders = scribe.logger("Orders");
		orders.debug("hidden");
		orders.info("placed", { orderId: 7 });
		orders.warn({ msg: "slow", ms: 900 });

		expect(capture.entries).toEqual([
			{ level: "info", name: "Orders", msg: "placed", fields: { orderId: 7 } },
			{ level: "warn", name: "Orders", msg: "slow", fields: { ms: 900 } },
		]);
		expect(capture.at("warn")).toHaveLength(1);
		expect(log).not.toHaveBeenCalled();
		capture.clear();
		expect(capture.entries).toEqual([]);
	});

	it("child binds fields, nests, and follows a later configure", () => {
		const first = new CaptureAdapter();
		scribe.configure({ adapter: first });
		const request = scribe.logger("Api").child({ requestId: "r-1" });
		const job = request.child({ job: "sync" });
		request.info("received");

		const second = new CaptureAdapter();
		scribe.configure({ adapter: second });
		job.info("done", { rows: 3 });

		expect(first.entries).toEqual([
			{ level: "info", name: "Api", msg: "received", fields: { requestId: "r-1" } },
		]);
		expect(second.entries).toEqual([
			{
				level: "info",
				name: "Api",
				msg: "done",
				fields: { requestId: "r-1", job: "sync", rows: 3 },
			},
		]);
	});

	it("child on the console adapter prints the bound fields", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		scribe.configure({ adapter: new ConsoleAdapter() });
		scribe.logger("Api").child({ requestId: "r-1" }).info("received");
		expect(spy).toHaveBeenCalledWith(expect.stringContaining("INFO [Api]: received"), {
			requestId: "r-1",
		});
	});

	it("serializes errors with their causes", () => {
		const capture = new CaptureAdapter();
		scribe.configure({ adapter: capture });
		const root = Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
		const err = new TypeError("fetch failed", { cause: root });
		scribe.logger("Http").error("upstream failed", err);
		scribe.logger("Http").error(err);

		const [withMessage, alone] = capture.entries;
		expect(withMessage).toMatchObject({
			msg: "upstream failed",
			err: {
				name: "TypeError",
				message: "fetch failed",
				stack: expect.stringContaining("TypeError: fetch failed"),
				cause: { name: "Error", message: "connection reset", code: "ECONNRESET" },
			},
		});
		expect(alone).toMatchObject({ msg: "fetch failed", err: { name: "TypeError" } });
	});

	it("follows causes three levels deep", () => {
		let err = new Error("level 0");
		for (let level = 1; level <= 5; level += 1) {
			err = new Error(`level ${level}`, { cause: err });
		}
		const serialized = serializeError(err);
		expect(serialized.cause).toMatchObject({ cause: { cause: { message: "level 2" } } });
		expect(serialized).not.toHaveProperty(["cause", "cause", "cause", "cause"]);
	});

	it("structured adapters censor the redaction keys at any depth", () => {
		const capture = new CaptureAdapter();
		scribe.configure({ adapter: capture });
		scribe
			.logger("Auth")
			.child({ session: { token: "bound-token-659" } })
			.info("login", { a: { b: { c: { password: "deep-password-659" } } } });

		expect(capture.entries[0].fields).toEqual({
			session: { token: "[Redacted]" },
			a: { b: { c: { password: "[Redacted]" } } },
		});
	});

	it("taps every written entry, whichever adapter writes it", () => {
		vi.spyOn(console, "log").mockImplementation(() => {});
		const tapped: LogEntry[] = [];
		scribe.configure({
			adapter: new ConsoleAdapter(),
			options: { logLevel: "warn" },
			tap: (entry) => tapped.push(entry),
		});
		const log = scribe.logger("Billing").child({ invoice: 12 });
		log.info("below the level");
		log.error("charge failed", { token: "tap-token-659" }, new Error("card declined"));
		log.error("charge failed", new Error("card declined"));

		expect(tapped).toHaveLength(2);
		// Redaction is the adapter's job: the tap gets the fields as logged.
		expect(tapped[0].fields).toMatchObject({ invoice: 12, token: "tap-token-659" });
		expect(tapped[1]).toMatchObject({
			level: "error",
			name: "Billing",
			msg: "charge failed",
			fields: { invoice: 12 },
			err: { message: "card declined" },
		});
	});

	it("a tap that throws does not break the call that logged", async () => {
		const capture = new CaptureAdapter();
		const failure = new Error("reporter down");
		const rethrown = new Promise<unknown>((resolve) => {
			vi.spyOn(globalThis, "queueMicrotask").mockImplementationOnce((task) => {
				try {
					task();
				} catch (err) {
					resolve(err);
				}
			});
		});
		scribe.configure({
			adapter: capture,
			tap: () => {
				throw failure;
			},
		});

		expect(() => scribe.logger("Tap").info("still written")).not.toThrow();
		expect(capture.entries).toHaveLength(1);
		await expect(rethrown).resolves.toBe(failure);
	});
});
