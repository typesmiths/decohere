import { http } from "../src/http/http.plugin.js";
import { auth } from "../src/auth/auth.plugin.js";
import { ServiceContainerBuilder } from "@decohere/crucible";
import axios from "axios";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AuthConfig } from "../src/auth/auth.config.js";
import { type App, Builder } from "@decohere/core/hosting";
import type { IConfigurationService } from "@decohere/core/configuration";
import { ConfigurationServiceToken } from "@decohere/core/configuration";
import type { Constructable } from "@decohere/core/reflection";
import { FastifyProvider } from "../src/providers/fastify.provider.js";
import { Authorize, Controller, Get } from "../src/routing/index.js";
import { listenEphemeral } from "./helpers/listen-ephemeral.js";
import { LocalOidcServer } from "./helpers/local-oidc-server.js";

// Started once for the whole suite — key generation is expensive.
let oidc: LocalOidcServer;

beforeAll(async () => {
	oidc = await LocalOidcServer.start();
});

afterAll(async () => {
	await oidc.stop();
});

// Configures the app to use discoveryUrl pointing at the local OIDC server.
class OidcConfigService implements IConfigurationService {
	public get dataSources() {
		return [];
	}
	public async get<T extends object>(type: Constructable<T> | string): Promise<T> {
		if (Object.is(type, AuthConfig)) {
			const config = new AuthConfig();
			config.discoveryUrl = oidc.issuer;
			config.audience = "https://api.test";
			return config as unknown as T;
		}
		return {} as T;
	}
}

@Authorize("read", "Article")
@Controller()
class OidcController {
	@Get("/resource")
	public resource() {
		return { ok: true };
	}
}

describe("Auth integration — discoveryUrl + real RS256 tokens", () => {
	let app: App;

	beforeEach(async () => {
		app = await Builder.create(new ServiceContainerBuilder())
			.use(http(FastifyProvider, { accessLog: false, controllers: [OidcController] }))
			.withServices((c) => {
				c.registerSingleton(ConfigurationServiceToken, new OidcConfigService());
			})
			.use(auth())
			.build();

		axios.defaults.baseURL = await listenEphemeral(app);
	});

	afterEach(async () => {
		await app.dispose();
	});

	it("returns 401 when no token is provided", async () => {
		await expect(axios.get("/oidc/resource")).rejects.toMatchObject({
			response: { status: 401 },
		});
	});

	it("accepts a valid RS256 token issued by the local IdP", async () => {
		const token = await oidc.signToken({ sub: "user-1", scope: "read:Article" });
		const res = await axios.get("/oidc/resource", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
	});

	it("returns 401 for a token signed with the wrong key", async () => {
		// Use the wrong OIDC server (different key pair)
		const wrongOidc = await LocalOidcServer.start();
		const token = await wrongOidc.signToken({ sub: "user-1", scope: "read:Article" });
		await wrongOidc.stop();

		await expect(
			axios.get("/oidc/resource", { headers: { Authorization: `Bearer ${token}` } }),
		).rejects.toMatchObject({ response: { status: 401 } });
	});

	it("returns 401 for an expired token", async () => {
		const token = await oidc.signToken({ sub: "user-1", scope: "read:Article" }, "-1s");
		await expect(
			axios.get("/oidc/resource", { headers: { Authorization: `Bearer ${token}` } }),
		).rejects.toMatchObject({ response: { status: 401 } });
	});

	it("returns 403 when the token lacks the required scope", async () => {
		const token = await oidc.signToken({ sub: "user-1", scope: "write:Article" });
		await expect(
			axios.get("/oidc/resource", { headers: { Authorization: `Bearer ${token}` } }),
		).rejects.toMatchObject({ response: { status: 403 } });
	});
});

describe("Auth integration — principalMapper", () => {
	let app: App;

	beforeEach(async () => {
		// Map Keycloak-style realm_access.roles to scopes
		app = await Builder.create(new ServiceContainerBuilder())
			.use(http(FastifyProvider, { accessLog: false, controllers: [OidcController] }))
			.withServices((c) => {
				c.registerSingleton(ConfigurationServiceToken, new OidcConfigService());
			})
			.use(
				auth(undefined, {
					principalMapper: (payload) => ({
						sub: payload.sub as string,
						scopes: ((payload.realm_access as { roles?: string[] })?.roles ?? []).map(
							(r) => `read:${r}`,
						),
					}),
				}),
			)
			.build();

		axios.defaults.baseURL = await listenEphemeral(app);
	});

	afterEach(async () => {
		await app.dispose();
	});

	it("maps custom claims to scopes via principalMapper", async () => {
		// Token uses realm_access.roles instead of scope claim
		const token = await oidc.signToken({
			sub: "user-1",
			realm_access: { roles: ["Article"] },
		});
		const res = await axios.get("/oidc/resource", {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
	});

	it("returns 403 when custom-mapped scopes do not satisfy the requirement", async () => {
		const token = await oidc.signToken({
			sub: "user-1",
			realm_access: { roles: ["OtherResource"] },
		});
		await expect(
			axios.get("/oidc/resource", { headers: { Authorization: `Bearer ${token}` } }),
		).rejects.toMatchObject({ response: { status: 403 } });
	});
});
