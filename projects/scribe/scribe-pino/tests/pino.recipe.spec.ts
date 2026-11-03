import { Environments } from "@decohere/core/system";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pinoRecipe } from "../src/pino.recipe.js";

const file = "logs/app.log";

afterEach(() => {
	vi.unstubAllEnvs();
});

describe("pinoRecipe.transport", () => {
	it("attaches pretty and roll in development", () => {
		expect(
			pinoRecipe.transport({ pretty: {}, roll: { file } }, Environments.development),
		).toEqual({
			targets: [
				{ target: "pino-pretty", options: { colorize: true } },
				{
					target: "pino-roll",
					options: {
						file,
						mkdir: true,
						size: "10m",
						frequency: "daily",
						limit: { count: 14 },
						symlink: false,
					},
				},
			],
		});
	});

	it("writes no in-process transports in production", () => {
		expect(
			pinoRecipe.transport({ pretty: {}, roll: { file } }, Environments.production),
		).toBeUndefined();
	});

	it("keeps roll in production when when is always", () => {
		expect(
			pinoRecipe.transport(
				{ roll: { file, when: "always", size: "5m", keep: 3 } },
				Environments.production,
			),
		).toEqual({
			target: "pino-roll",
			options: {
				file,
				mkdir: true,
				size: "5m",
				frequency: "daily",
				limit: { count: 3 },
				symlink: false,
			},
		});
	});

	it("opts into symlink only when requested", () => {
		expect(
			pinoRecipe.transport({ roll: { file, symlink: true } }, Environments.development),
		).toEqual({
			target: "pino-roll",
			options: {
				file,
				mkdir: true,
				size: "10m",
				frequency: "daily",
				limit: { count: 14 },
				symlink: true,
			},
		});
	});

	it("overrides file from SCRIBE_LOG_FILE", () => {
		vi.stubEnv("SCRIBE_LOG_FILE", " /var/log/app.log ");
		expect(pinoRecipe.transport({ roll: { file } }, Environments.development)).toEqual({
			target: "pino-roll",
			options: {
				file: "/var/log/app.log",
				mkdir: true,
				size: "10m",
				frequency: "daily",
				limit: { count: 14 },
				symlink: false,
			},
		});
	});

	it("ignores blank SCRIBE_LOG_FILE", () => {
		vi.stubEnv("SCRIBE_LOG_FILE", "   ");
		expect(
			pinoRecipe.transport({ roll: { file } }, Environments.development)?.options,
		).toMatchObject({ file });
	});

	it("reads size frequency keep from SCRIBE_LOG_* when unset", () => {
		vi.stubEnv("SCRIBE_LOG_SIZE", "5m");
		vi.stubEnv("SCRIBE_LOG_FREQUENCY", "hourly");
		vi.stubEnv("SCRIBE_LOG_KEEP", "7");
		expect(pinoRecipe.transport({ roll: { file } }, Environments.development)).toEqual({
			target: "pino-roll",
			options: {
				file,
				mkdir: true,
				size: "5m",
				frequency: "hourly",
				limit: { count: 7 },
				symlink: false,
			},
		});
	});

	it("parses numeric SCRIBE_LOG_FREQUENCY as milliseconds", () => {
		vi.stubEnv("SCRIBE_LOG_FREQUENCY", "3600000");
		expect(
			pinoRecipe.transport({ roll: { file } }, Environments.development)?.options,
		).toMatchObject({ frequency: 3_600_000 });
	});

	it("lets explicit size frequency keep beat env", () => {
		vi.stubEnv("SCRIBE_LOG_SIZE", "1m");
		vi.stubEnv("SCRIBE_LOG_FREQUENCY", "hourly");
		vi.stubEnv("SCRIBE_LOG_KEEP", "2");
		expect(
			pinoRecipe.transport(
				{ roll: { file, size: "20m", frequency: "daily", keep: 30 } },
				Environments.development,
			)?.options,
		).toMatchObject({
			size: "20m",
			frequency: "daily",
			limit: { count: 30 },
		});
	});

	it("ignores invalid SCRIBE_LOG_KEEP", () => {
		vi.stubEnv("SCRIBE_LOG_KEEP", "nope");
		expect(
			pinoRecipe.transport({ roll: { file } }, Environments.development)?.options,
		).toMatchObject({ limit: { count: 14 } });
	});
});
