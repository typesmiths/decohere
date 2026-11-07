import { http } from "../src/http/http.plugin.js";
import { health } from "../src/health/health.plugin.js";
import { auth } from "../src/auth/auth.plugin.js";
import { ServiceContainerBuilder } from "@decohere/crucible";
import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthConfig } from "../src/auth/auth.config.js";
import { type App, Builder } from "@decohere/core/hosting";
import type { IReadinessCheck } from "@decohere/core/hosting";
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
		if (Object.is(type, AuthConfig)) {
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
		app = await Builder.create(new ServiceContainerBuilder())
			.use(http(FastifyProvider, { accessLog: false }))
			.use(health())
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);

		const res = await axios.get("/health");
		expect(res.status).toBe(200);
		expect(res.data).toEqual({ status: "ok" });
	});

	it("GET /ready returns 200 when no readiness checks are registered", async () => {
		app = await Builder.create(new ServiceContainerBuilder())
			.use(http(FastifyProvider, { accessLog: false }))
			.use(health())
			.build();
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

		app = await Builder.create(new ServiceContainerBuilder())
			.use(http(FastifyProvider, { accessLog: false }))
			.use(health({ checks: [failing] }))
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);

		const res = await axios.get("/ready", { validateStatus: () => true });
		expect(res.status).toBe(503);
		expect(res.data).toEqual({ message: "Not ready" });
	});

	it("GET /health and /ready stay anonymous when auth() is enabled", async () => {
		vi.stubEnv("NODE_ENV", "development");

		app = await Builder.create(new ServiceContainerBuilder())
			.use(http(FastifyProvider, { accessLog: false, controllers: [GuardController] }))
			.withServices((c) => {
				c.registerSingleton(ConfigurationServiceToken, new DevStaticConfigService());
			})
			.use(auth())
			.use(health())
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);

		const liveness = await axios.get("/health");
		expect(liveness.status).toBe(200);
		expect(liveness.data).toEqual({ status: "ok" });

		const ready = await axios.get("/ready");
		expect(ready.status).toBe(200);
		expect(ready.data).toEqual({ status: "ok" });

		await expect(axios.get("/guard/protected")).rejects.toMatchObject({
			response: { status: 401 },
		});
	});
});
