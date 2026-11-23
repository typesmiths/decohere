import { scribe } from "@decohere/scribe";
import { afterEach, describe, expect, it } from "vitest";
import * as scribePino from "./index.js";
import { PinoAdapter } from "./pino.adapter.js";
import { pino } from "./pino.plugin.js";

afterEach(async () => {
	await scribe.stop();
});

describe("pino()", () => {
	it("changes nothing on import: scribe gets no Pino methods", () => {
		expect(scribePino.pino).toBeTypeOf("function");
		expect("withPino" in scribe).toBe(false);
		expect("withPinoPretty" in scribe).toBe(false);
	});

	it("is a writer scribe.use takes, and loggers made after it work", () => {
		const writer = pino();
		expect(writer).toBeInstanceOf(PinoAdapter);
		scribe.use(writer, { logLevel: "warn" });
		const log = scribe.logger("test");
		expect(log.currentLevel).toBe("warn");
		expect(log.isLevelEnabled("info")).toBe(false);
	});

	it("accepts any Pino transport in place of pretty and roll", () => {
		scribe.use(pino({ transport: { target: "pino/file", options: { destination: 1 } } }));
		expect(scribe.logger("test").isLevelEnabled("info")).toBe(true);
	});
});
