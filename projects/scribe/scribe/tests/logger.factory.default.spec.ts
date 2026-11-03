import { describe, expect, it, vi } from "vitest";
import { ConsoleAdapter } from "../src/console.adapter.js";
import { scribe } from "../src/logger.factory.js";

describe("Logger Factory with Default Adapter", () => {
	it("should use console adapter by default", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		// No configuration needed
		const logger = scribe.logger("default-test");

		logger.info("This should work");

		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	it("warns once when logging without configure (default ConsoleAdapter)", () => {
		const err = vi.spyOn(console, "warn").mockImplementation(() => {});
		const fresh = new scribe();

		fresh.getLogger("unconfigured");
		fresh.getLogger("unconfigured-again");

		const messages = err.mock.calls.map((call) => String(call[0]));
		expect(
			messages.filter((m) => m.includes("[scribe] No logger adapter configured")),
		).toHaveLength(1);
		expect(messages[0]).toContain(
			"https://github.com/typesmiths/decohere/blob/main/projects/scribe/README.md",
		);
		err.mockRestore();
	});

	it("does not warn after configure installs an adapter", () => {
		const err = vi.spyOn(console, "warn").mockImplementation(() => {});
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		scribe.configure({ adapter: new ConsoleAdapter() });
		scribe.logger("configured").info("ok");

		expect(
			err.mock.calls.some((call) =>
				String(call[0]).includes("[scribe] No logger adapter configured"),
			),
		).toBe(false);
		err.mockRestore();
		log.mockRestore();
	});

	it("should allow configuring a different adapter", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		// Configure with explicit console adapter
		const loggerFn = scribe.configure({
			adapter: new ConsoleAdapter(),
		});

		const logger = loggerFn("configured-test");
		logger.warn("Configured message");

		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("WARN [configured-test]: Configured message"),
		);

		spy.mockRestore();
	});

	it("should work for multiple logger instances", () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});

		const logger1 = scribe.logger("service1");
		const logger2 = scribe.logger("service2");

		logger1.info("Message from service1");
		logger2.error("Message from service2");

		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("INFO [service1]: Message from service1"),
		);
		expect(spy).toHaveBeenCalledWith(
			expect.stringContaining("ERROR [service2]: Message from service2"),
		);

		spy.mockRestore();
	});

	it("stop drains the active adapter", async () => {
		await expect(scribe.stop()).resolves.toBeUndefined();
		await expect(scribe.stop()).resolves.toBeUndefined();
	});
});
