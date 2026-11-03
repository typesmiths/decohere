import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { App } from "../src/app/app.js";
import { AuthConfig } from "../src/auth/auth.config.js";
import "../src/auth/auth.extensions.js";
import type { IPrincipalProvider } from "../src/auth/principal-provider.js";
import { Builder } from "../src/builder/builder.js";
import { IPrincipalProviderToken } from "../src/const.js";
import "../src/http/http.extensions.js";
import { inject } from "@decohere/crucible/decorators";
import type { IConfigurationService } from "@decohere/core/configuration";
import { ConfigurationServiceToken } from "@decohere/core/configuration";
import type { Constructable } from "@decohere/core/reflection";
import type { Principal } from "../src/auth/auth.types.js";
import { FastifyProvider } from "../src/providers/fastify.provider.js";
import {
	AllowAnonymous,
	Authorize,
	Controller,
	CurrentUser,
	Get,
	Query,
} from "../src/routing/index.js";
import { listenEphemeral } from "./helpers/listen-ephemeral.js";

// Provides devStatic auth config — no JWT signing required.
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

// Defined at module scope so decorator metadata is stable across all tests.
// Class name "GuardController" → prefix "guard" → routes at /guard/...
@Controller()
class GuardController {
	public constructor(
		@inject(IPrincipalProviderToken) private readonly principalProvider: IPrincipalProvider,
	) {}

	@Authorize("read", "Article")
	@Get("/me")
	public me(@CurrentUser() user: Principal) {
		return { sub: user?.sub };
	}

	@Authorize("read", "Article")
	@Get("/me-search")
	public meSearch(@CurrentUser() user: Principal, @Query("q") q: string) {
		return { sub: user?.sub, q };
	}

	@Authorize("read", "Article")
	@Get("/protected")
	public secure() {
		return { sub: this.principalProvider.currentPrincipal?.sub };
	}

	@Authorize("delete", "Article")
	@Get("/admin")
	public admin() {
		return { ok: true };
	}

	@AllowAnonymous()
	@Get("/open")
	public open() {
		return { ok: true };
	}
}

// Class-level @Authorize — methods inherit unless they override or opt out.
@Authorize("read", "Article")
@Controller()
class ClassAuthController {
	@Get("/inherited")
	public inherited() {
		return { ok: true };
	}

	@AllowAnonymous()
	@Get("/opt-out")
	public optOut() {
		return { ok: true };
	}

	@Authorize("delete", "Article")
	@Get("/override")
	public override() {
		return { ok: true };
	}
}

describe("Auth integration — devStatic", () => {
	let app: App;

	beforeEach(async () => {
		vi.stubEnv("NODE_ENV", "development");

		app = await Builder.create()
			.withHttpProvider(FastifyProvider)
			.withServices((c) => {
				c.registerSingleton(ConfigurationServiceToken, new DevStaticConfigService());
			})
			.withAuth()
			.withControllers(GuardController, ClassAuthController)
			.build();

		axios.defaults.baseURL = await listenEphemeral(app);
	});

	afterEach(async () => {
		await app.dispose();
		vi.unstubAllEnvs();
	});

	describe("@AllowAnonymous", () => {
		it("allows requests with no token", async () => {
			const res = await axios.get("/guard/open");
			expect(res.status).toBe(200);
			expect(res.data).toEqual({ ok: true });
		});
	});

	describe("missing token", () => {
		it("returns 401 when no Authorization header is present", async () => {
			await expect(axios.get("/guard/protected")).rejects.toMatchObject({
				response: { status: 401 },
			});
		});

		it("returns a generic Unauthorized body (no internal auth detail)", async () => {
			const res = await axios.get("/guard/protected", { validateStatus: () => true });
			expect(res.status).toBe(401);
			expect(res.data).toEqual({ message: "Unauthorized" });
			expect(JSON.stringify(res.data)).not.toMatch(/Authorization|header|Bearer/i);
		});

		it("returns 401 when the Authorization header has no Bearer prefix", async () => {
			await expect(
				axios.get("/guard/protected", { headers: { Authorization: "any-token" } }),
			).rejects.toMatchObject({ response: { status: 401 } });
		});

		it("sanitizes malformed Authorization header bodies to Unauthorized", async () => {
			const res = await axios.get("/guard/protected", {
				headers: { Authorization: "any-token" },
				validateStatus: () => true,
			});
			expect(res.status).toBe(401);
			expect(res.data).toEqual({ message: "Unauthorized" });
		});
	});

	describe("insufficient ability", () => {
		it("returns 403 when the principal cannot perform the required action", async () => {
			// devStatic principal has read:Article but not delete:Article
			const res = await axios.get("/guard/admin", {
				headers: { Authorization: "Bearer any-token" },
				validateStatus: () => true,
			});
			expect(res.status).toBe(403);
			expect(res.data).toEqual({ message: expect.stringMatching(/delete.*Article/) });
		});
	});

	describe("authorized access", () => {
		it("allows the devStatic principal to access a permitted route", async () => {
			const res = await axios.get("/guard/protected", {
				headers: { Authorization: "Bearer any-token" },
			});
			expect(res.status).toBe(200);
		});

		it("resolves the principal via IPrincipalProvider", async () => {
			const res = await axios.get("/guard/protected", {
				headers: { Authorization: "Bearer any-token" },
			});
			expect(res.data).toEqual({ sub: "dev-user" });
		});

		it("injects the principal through @CurrentUser", async () => {
			const res = await axios.get("/guard/me", {
				headers: { Authorization: "Bearer any-token" },
			});
			expect(res.status).toBe(200);
			expect(res.data).toEqual({ sub: "dev-user" });
		});

		it("injects @CurrentUser alongside a query argument", async () => {
			const res = await axios.get("/guard/me-search", {
				headers: { Authorization: "Bearer any-token" },
				params: { q: "hi" },
			});
			expect(res.status).toBe(200);
			expect(res.data).toEqual({ sub: "dev-user", q: "hi" });
		});
	});

	describe("class-level @Authorize", () => {
		it("protects a method with no decorator using the class-level constraint", async () => {
			await expect(axios.get("/classauth/inherited")).rejects.toMatchObject({
				response: { status: 401 },
			});
		});

		it("allows access to an inherited route when the principal satisfies the class constraint", async () => {
			const res = await axios.get("/classauth/inherited", {
				headers: { Authorization: "Bearer any-token" },
			});
			expect(res.status).toBe(200);
		});

		it("allows anonymous access to a method decorated with @AllowAnonymous", async () => {
			const res = await axios.get("/classauth/opt-out");
			expect(res.status).toBe(200);
		});

		it("uses the method-level constraint when it overrides the class-level one", async () => {
			// devStatic principal has read:Article but not delete:Article
			await expect(
				axios.get("/classauth/override", { headers: { Authorization: "Bearer any-token" } }),
			).rejects.toMatchObject({ response: { status: 403 } });
		});
	});
});
