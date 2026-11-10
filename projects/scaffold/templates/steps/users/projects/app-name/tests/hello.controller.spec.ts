import { config, EnvDataSource } from "@decohere/config";
import { auth } from "@decohere/http";
import { bootModule } from "@decohere/http/testing";
import { afterEach, expect, it, vi } from "vitest";
import { HelloController } from "../src/controllers/hello.controller.js";
import { SampleService } from "../src/services/sample.service.js";
import { UserService } from "../src/services/user.service.js";

afterEach(() => {
	vi.unstubAllEnvs();
});

// The Hello controller on its own, as a real app on a free port. To test the whole app
// instead: `await using api = await startTestApp(createApp());`
it("GET /hello answers with the greeting from config", async () => {
	vi.stubEnv("SAMPLE__GREETING", "Hello from a test");
	// Tokens are checked with a secret only this test knows, so it needs no Auth0 tenant.
	vi.stubEnv("AUTH__SECRET", "a-secret-only-this-test-knows");
	vi.stubEnv("AUTH__AUDIENCE", "hello-test");
	await using api = await bootModule({
		controllers: [HelloController],
		services: (services) => {
			services.registerSingleton(SampleService);
			// GET /hello reads no users: a stand-in, so the test needs no database.
			services.registerSingleton(UserService, {
				ensureFromPrincipal: () => Promise.reject(new Error("No database in this test")),
			});
		},
		configure: (builder) => builder.use(config(EnvDataSource)).use(auth()),
	});

	const response = await fetch(`${api.baseUrl}/hello`);

	expect(response.status).toBe(200);
	expect(await response.json()).toEqual({ message: "Hello from a test" });
});
