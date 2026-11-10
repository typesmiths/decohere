import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ConfigurationServiceToken,
	type IConfigurationService,
} from "@decohere/core/configuration";
import { Builder } from "@decohere/core/hosting";
import { ServiceContainerBuilder } from "@decohere/crucible";
import { inject, injectable } from "@decohere/crucible/decorators";
import { Controller, Get } from "@decohere/http";
import { startTestApp } from "@decohere/http/testing";
import { webApi } from "@decohere/http/web-api";
import { scribe } from "@decohere/scribe";
import { afterEach, describe, expect, it, vi } from "vitest";
import { realFs } from "../../../vitest.setup.js";

class GreetingConfig {
	public text = "Hello";
}

@injectable()
class Greeter {
	public constructor(
		@inject(ConfigurationServiceToken) private readonly config: IConfigurationService,
	) {}

	public async greet(name: string) {
		return `${(await this.config.get(GreetingConfig)).text}, ${name}!`;
	}
}

@Controller({ prefix: "/hello" })
class HelloController {
	public constructor(@inject(Greeter) private readonly greeter: Greeter) {}

	@Get()
	public async hello() {
		return { message: await this.greeter.greet("world") };
	}
}

describe("webApi(): an API in a few lines", () => {
	let logDir: string | undefined;

	afterEach(async () => {
		vi.unstubAllEnvs();
		await scribe.stop();
		if (logDir != null) realFs.rmSync(logDir, { recursive: true, force: true });
		logDir = undefined;
	});

	it("serves a controller, /health and the OpenAPI document with nothing else set up", async () => {
		// Pino writes in a worker thread, on the real disk: keep its rolled file out of the repo.
		logDir = realFs.mkdtempSync(join(tmpdir(), "web-api-"));
		vi.stubEnv("SCRIBE_LOG_FILE", join(logDir, "hello.log"));

		// The whole app, as a developer writes it: no config file, no logging setup.
		const app = Builder.create(new ServiceContainerBuilder())
			.use(webApi({ controllers: [HelloController] }))
			.withServices((services) => services.registerSingleton(Greeter))
			.build();
		await using api = await startTestApp(app);

		const hello = await fetch(`${api.baseUrl}/hello`);
		expect(hello.status).toBe(200);
		expect(await hello.json()).toEqual({ message: "Hello, world!" });

		const health = await fetch(`${api.baseUrl}/health`);
		expect(health.status).toBe(200);

		const openApi = await fetch(`${api.baseUrl}/openapi.json`);
		expect(openApi.status).toBe(200);
		const document = (await openApi.json()) as { paths: Record<string, unknown> };
		expect(Object.keys(document.paths)).toContain("/hello");
	});

	it("reads configuration from the environment, over the YAML files", async () => {
		vi.stubEnv("GREETING__TEXT", "Hi");

		await using api = await startTestApp(
			Builder.create(new ServiceContainerBuilder())
				.use(webApi({ controllers: [HelloController], logging: false }))
				.withServices((services) => services.registerSingleton(Greeter))
				.build(),
		);

		const hello = await fetch(`${api.baseUrl}/hello`);
		expect(await hello.json()).toEqual({ message: "Hi, world!" });
	});

	it("leaves out what is turned off", async () => {
		await using api = await startTestApp(
			Builder.create(new ServiceContainerBuilder())
				.use(
					webApi({
						controllers: [HelloController],
						logging: false,
						health: false,
						openApi: false,
					}),
				)
				.withServices((services) => services.registerSingleton(Greeter))
				.build(),
		);

		expect((await fetch(`${api.baseUrl}/health`)).status).toBe(404);
		expect((await fetch(`${api.baseUrl}/openapi.json`)).status).toBe(404);
		expect((await fetch(`${api.baseUrl}/hello`)).status).toBe(200);
	});

	it("passes HTTP settings through, such as a global prefix", async () => {
		await using api = await startTestApp(
			Builder.create(new ServiceContainerBuilder())
				.use(
					webApi({
						controllers: [HelloController],
						logging: false,
						http: { globalPrefix: "/api" },
						openApi: { info: { title: "Greetings", version: "2.0.0" } },
					}),
				)
				.withServices((services) => services.registerSingleton(Greeter))
				.build(),
		);

		expect((await fetch(`${api.baseUrl}/api/hello`)).status).toBe(200);
		// The probes stay at the root.
		expect((await fetch(`${api.baseUrl}/health`)).status).toBe(200);
		const document = (await (await fetch(`${api.baseUrl}/openapi.json`)).json()) as {
			info: { title: string; version: string };
		};
		expect(document.info).toEqual({ title: "Greetings", version: "2.0.0" });
	});
});
