import { http } from "../src/http/http.plugin.js";
import { ServiceContainerBuilder } from "@decohere/crucible";
/**
 * Reproduces Flux hot-reload + pino-roll: App.dispose must finish so reboot can listen again.
 *
 * Scaffold pattern: scribe.withPinoPretty().and.withPinoRoll({ file }) then export default app.
 * Flux disposeEntry → App.dispose → container asyncDispose → scribe.stop() must not hang on ThreadStream.end().
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import "@decohere/scribe-pino";
import { scribe } from "@decohere/scribe";
import axios from "axios";
import { afterEach, describe, expect, it } from "vitest";
import { realFs } from "../../../vitest.setup.js";
import { type App, Builder } from "@decohere/core/hosting";
import { FastifyProvider } from "../src/providers/fastify.provider.js";
import { Controller, Get } from "../src/routing/index.js";
import { startTestApp } from "../src/testing/index.js";

@Controller({ prefix: "/funding-arb" })
class FundingArbStubController {
	@Get()
	public state() {
		return { ok: true };
	}
}

async function bootWithPinoRoll(logFile: string): Promise<App> {
	scribe.withPinoPretty().and.withPinoRoll({
		file: logFile,
		when: "always",
		size: "1m",
		keep: 2,
		mkdir: true,
	});
	return Builder.create(new ServiceContainerBuilder())
		.use(http(FastifyProvider, { controllers: [FundingArbStubController] }))
		.build();
}

describe("Flux-style reboot with pino-roll", () => {
	let logDir: string;
	let app: App | undefined;

	afterEach(async () => {
		if (app != null) {
			await app.dispose();
			app = undefined;
		}
		await scribe.stop();
		if (logDir != null) {
			realFs.rmSync(logDir, { recursive: true, force: true });
		}
	});

	it("listens again after App.dispose + withPinoRoll reconfigure (HMR cycle)", async () => {
		logDir = realFs.mkdtempSync(join(tmpdir(), "http-pino-roll-hmr-"));
		const logFile = join(logDir, "funding-fee.api.log");

		app = await bootWithPinoRoll(logFile);
		const origin1 = (await startTestApp(app)).baseUrl;
		const first = await axios.get(`${origin1}/funding-arb`);
		expect(first.status).toBe(200);
		expect(first.data).toEqual({ ok: true });

		const dying = app;
		app = undefined;
		await dying.dispose();

		app = await bootWithPinoRoll(logFile);
		const origin2 = (await startTestApp(app)).baseUrl;
		const second = await axios.get(`${origin2}/funding-arb`, { timeout: 5_000 });

		expect(second.status).toBe(200);
		expect(second.data).toEqual({ ok: true });
	}, 20_000);
});
