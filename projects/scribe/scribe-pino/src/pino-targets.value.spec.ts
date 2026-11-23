import { describe, expect, it } from "vitest";
import { PinoTargets } from "./pino-targets.value.js";

const file = "logs/app.log";
const rollDefaults = {
	file,
	mkdir: true,
	size: "10m",
	frequency: "daily",
	limit: { count: 14 },
	symlink: false,
};

describe("PinoTargets", () => {
	it("has no transport when nothing is asked for, so Pino writes JSON to stdout", () => {
		expect(new PinoTargets(undefined, undefined).transport).toBeUndefined();
	});

	it("sends every entry to both pretty and roll when both are asked for", () => {
		expect(new PinoTargets({}, { file }).transport).toEqual({
			targets: [
				{ target: "pino-pretty", options: { colorize: true } },
				{ target: "pino-roll", options: rollDefaults },
			],
		});
	});

	it("uses one target on its own, not a list of one", () => {
		expect(new PinoTargets({ colorize: false }, undefined).transport).toEqual({
			target: "pino-pretty",
			options: { colorize: false },
		});
	});

	it("keeps the roll options it is given over the defaults", () => {
		expect(
			new PinoTargets(undefined, {
				file,
				size: "5m",
				frequency: 60_000,
				keep: 3,
				mkdir: false,
				symlink: true,
			}).transport,
		).toEqual({
			target: "pino-roll",
			options: {
				file,
				mkdir: false,
				size: "5m",
				frequency: 60_000,
				limit: { count: 3 },
				symlink: true,
			},
		});
	});
});
