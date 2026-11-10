import { config, EnvDataSource } from "@decohere/config";
import { bootModule } from "@decohere/http/testing";
import { afterEach, expect, it, vi } from "vitest";
import { HelloController } from "../src/controllers/hello.controller.js";
import { SampleService } from "../src/services/sample.service.js";

afterEach(() => {
	vi.unstubAllEnvs();
});

// The Hello controller on its own, as a real app on a free port. To test the whole app
// instead: `await using api = await startTestApp(createApp());`
it("GET /hello answers with the greeting from config", async () => {
	vi.stubEnv("SAMPLE__GREETING", "Hello from a test");
	await using api = await bootModule({
		controllers: [HelloController],
		services: (services) => {
			services.registerSingleton(SampleService);
		},
		configure: (builder) => builder.use(config(EnvDataSource)),
	});

	const response = await fetch(`${api.baseUrl}/hello`);

	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ message: "Hello from a test" });
});
