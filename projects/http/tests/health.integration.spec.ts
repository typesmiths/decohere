import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { App } from "../src/app/app.js";
import { AuthConfig } from "../src/auth/auth.config.js";
import "../src/auth/auth.extensions.js";
import { Builder } from "../src/builder/builder.js";
import type { IReadinessCheck } from "../src/health/readiness.types.js";
import "../src/http/http.extensions.js";
import "../src/health/health.extensions.js";
import type { IConfigurationService } from "@decohere/core/configuration";
import { ConfigurationServiceToken } from "@decohere/core/configuration";
import type { Constructable } from "@decohere/core/reflection";
import { FastifyProvider } from "../src/providers/fastify.provider.js";
import { Authorize, Controller, Get } from "../src/routing/index.js";
import { listenEphemeral } from "./helpers/listen-ephemeral.js";

class DevStaticConfigService implements IConfigurationService {
	public get dataSources() {
		return [];
	}
	public async get<T extends object>(type: Constructable<T> | string): Promise<T> {
		if (type === AuthConfig) {
			const config = new AuthConfig();
			config.devStatic = { sub: "dev-user", scopes: ["read:Article"] };
			return config as unknown as T;
		}
		return {} as T;
	}
}

@Controller()
class GuardController {
	@Authorize("read", "Article")
	@Get("/protected")
	public secure() {
		return { ok: true };
	}
}

describe("health / ready probes", () => {
	let app: App;

	afterEach(async () => {
		await app?.dispose();
		vi.unstubAllEnvs();
	});

	it("GET /health returns 200 { status: ok } without auth", async () => {
		app = await Builder.create().withHttpProvider(FastifyProvider).withHealth().build();
		axios.defaults.baseURL = await listenEphemeral(app);

		const res = await axios.get("/health");
		expect(res.status).toBe(200);
		expect(res.data).toEqual({ status: "ok" });
	});

	it("GET /ready returns 200 when no readiness checks are registered", async () => {
		app = await Builder.create().withHttpProvider(FastifyProvider).withHealth().build();
		axios.defaults.baseURL = await listenEphemeral(app);

		const res = await axios.get("/ready");
		expect(res.status).toBe(200);
		expect(res.data).toEqual({ status: "ok" });
	});

	it("GET /ready returns 503 when a readiness check fails", async () => {
		const failing: IReadinessCheck = {
			name: "db",
			async check() {
				throw new Error("connection refused");
			},
		};

		app = await Builder.create()
			.withHttpProvider(FastifyProvider)
			.withHealth({ checks: [failing] })
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);

		const res = await axios.get("/ready", { validateStatus: () => true });
		expect(res.status).toBe(503);
		expect(res.data).toEqual({ message: "Not ready" });
	});

	it("GET /health and /ready stay anonymous when withAuth is enabled", async () => {
		vi.stubEnv("NODE_ENV", "development");

		app = await Builder.create()
			.withHttpProvider(FastifyProvider)
			.withServices((c) => {
				c.registerSingleton(ConfigurationServiceToken, new DevStaticConfigService());
			})
			.withAuth()
			.withHealth()
			.withControllers(GuardController)
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);

		const health = await axios.get("/health");
		expect(health.status).toBe(200);
		expect(health.data).toEqual({ status: "ok" });

		const ready = await axios.get("/ready");
		expect(ready.status).toBe(200);
		expect(ready.data).toEqual({ status: "ok" });

		await expect(axios.get("/guard/protected")).rejects.toMatchObject({
			response: { status: 401 },
		});
	});
});
