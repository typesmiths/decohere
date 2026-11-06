import { configureHttp } from "../src/http/http.plugin.js";
import { health } from "../src/health/health.plugin.js";
import { auth } from "../src/auth/auth.plugin.js";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	type IConfigurationService,
	ConfigurationServiceToken,
} from "@decohere/core/configuration";
import type { Constructable } from "@decohere/core/reflection";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthConfig } from "../src/auth/auth.config.js";
import { TokenService } from "../src/auth/token-service.js";
import type { StaticOptions } from "../src/http/http.static.js";
import { AllowAnonymous, Authorize, Controller, Get } from "../src/index.js";
import type { OpenApiDocument } from "../src/openapi/openapi.types.js";
import { bootModule } from "../src/testing/index.js";

// The suite's fs is an in-memory fake. Static files are read by the real server from real disk.
vi.unmock("fs");
vi.unmock("fs/promises");
vi.unmock("node:fs");
vi.unmock("node:fs/promises");

const secretConfig = {
	secret: "super-secret-key-that-is-long-enough-for-hs256",
	issuer: "test-issuer",
	audience: "test-audience",
};

class SecretConfigService implements IConfigurationService {
	public get dataSources() {
		return [];
	}
	public async get<T extends object>(type: Constructable<T> | string): Promise<T> {
		if (type === AuthConfig)
			return Object.assign(new AuthConfig(), secretConfig) as unknown as T;
		return {} as T;
	}
}

@Controller({ prefix: "/api" })
class SecuredController {
	@Authorize("read", "Article")
	@Get("/articles")
	public articles() {
		return { secret: true };
	}
}

@Controller({ prefix: "/api" })
class ApiController {
	@Get("/ping")
	public ping() {
		return { pong: true };
	}
}

/** What a browser sends when it navigates: the SPA fallback only answers this kind of request. */
const browser = { accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" };

@Controller({ prefix: "/lp" })
class PortfolioController {
	@AllowAnonymous()
	@Get("/portfolio")
	public portfolio() {
		return { positions: [] };
	}
}

let site: string;
let ui: string;

beforeAll(async () => {
	site = await mkdtemp(path.join(tmpdir(), "http-static-"));
	ui = path.join(site, "ui");
	await mkdir(path.join(ui, "assets"), { recursive: true });
	await mkdir(path.join(ui, "empty-dir"), { recursive: true });
	await mkdir(path.join(ui, ".hidden"), { recursive: true });
	await writeFile(path.join(ui, "index.html"), "<!doctype html><title>the app</title>");
	await writeFile(path.join(ui, "assets/index-DiwrgTda.js"), "console.log('app')");
	await writeFile(path.join(ui, "assets/style.3f9a8c1b.css"), "body{}");
	await writeFile(path.join(ui, "assets/logo-background.png"), "png");
	await writeFile(path.join(ui, "remoteEntry.js"), "export default {}");
	await writeFile(path.join(ui, "favicon.ico"), "ico");
	await writeFile(path.join(ui, ".env"), "SECRET=1");
	await writeFile(path.join(ui, ".hidden/key.txt"), "key");
	// Beside the served folder, never to be reachable through it.
	await writeFile(path.join(site, "secret.txt"), "outside the root");
	await writeFile(path.join(site, "ui-sibling.txt"), "sibling");
});

afterAll(async () => {
	await rm(site, { recursive: true, force: true });
});

/**
 * These tests are about caching, paths and security, not about encodings, and most of them read
 * only the headers. A streamed file that is compressed (the HTTP package compresses responses, see
 * http.compression.integration.spec.ts) stays open until the client reads it, and an unread body
 * would hold up stopping the app. So ask for the plain file; the compression suite covers the rest.
 */
const fetch: typeof globalThis.fetch = (input, init) =>
	globalThis.fetch(input, {
		...init,
		headers: { "accept-encoding": "identity", ...(init?.headers as Record<string, string>) },
	});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

function boot(
	configure: (
		builder: Parameters<NonNullable<Parameters<typeof bootModule>[0]["configure"]>>[0],
	) => unknown = () => undefined,
) {
	return bootModule({
		controllers: [ApiController],
		configure: (builder) => {
			builder.use(configureHttp({ statics: [{ prefix: "/ui/", directory: ui }] }));
			return configure(builder);
		},
	});
}

/** A request with the path exactly as written; `fetch` would tidy `..` away before it left. */
function raw(
	baseUrl: string,
	rawPath: string,
	init: { method?: string; headers?: Record<string, string> } = {},
) {
	const url = new URL(baseUrl);
	return new Promise<{
		status: number;
		headers: Record<string, string | string[] | undefined>;
		body: string;
	}>((resolve, reject) => {
		const req = request(
			{
				host: url.hostname,
				port: url.port,
				path: rawPath,
				method: init.method ?? "GET",
				headers: init.headers,
			},
			(res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => {
					body += chunk;
				});
				res.on("end", () =>
					resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
				);
			},
		);
		req.on("error", reject);
		req.end();
	});
}

describe("serving a built UI from the API", () => {
	describe("caching", () => {
		it("caches a hashed asset for a year, as immutable", async () => {
			await using api = await boot();

			for (const file of ["assets/index-DiwrgTda.js", "assets/style.3f9a8c1b.css"]) {
				const response = await fetch(`${api.baseUrl}/ui/${file}`);
				expect(response.status).toBe(200);
				expect(response.headers.get("cache-control")).toBe(
					"public, max-age=31536000, immutable",
				);
			}
		});

		it("serves index.html at the prefix with no-cache", async () => {
			await using api = await boot();

			const response = await fetch(`${api.baseUrl}/ui/`);

			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toContain("text/html");
			expect(response.headers.get("cache-control")).toBe("no-cache");
			expect(await response.text()).toContain("the app");
		});

		it("serves the module-federation remote entry with no-cache", async () => {
			await using api = await boot();

			const response = await fetch(`${api.baseUrl}/ui/remoteEntry.js`);

			expect(response.headers.get("cache-control")).toBe("no-cache");
		});

		it("revalidates every other file, including a name that is not a hash", async () => {
			await using api = await boot();

			for (const file of ["favicon.ico", "assets/logo-background.png"]) {
				const response = await fetch(`${api.baseUrl}/ui/${file}`);
				expect(response.headers.get("cache-control")).toBe(
					"public, max-age=0, must-revalidate",
				);
				expect(response.headers.get("etag")).toBeTruthy();
				expect(response.headers.get("last-modified")).toBeTruthy();
			}
		});

		it("answers a conditional request with 304 and no body", async () => {
			await using api = await boot();
			const file = "/ui/assets/index-DiwrgTda.js";
			const first = await raw(api.baseUrl, file);
			const etag = first.headers.etag as string;
			const modified = first.headers["last-modified"] as string;

			const byEtag = await raw(api.baseUrl, file, { headers: { "if-none-match": etag } });
			const byDate = await raw(api.baseUrl, file, {
				headers: { "if-modified-since": modified },
			});
			const changed = await raw(api.baseUrl, file, {
				headers: { "if-none-match": '"other"' },
			});

			expect(byEtag.status).toBe(304);
			expect(byEtag.body).toBe("");
			expect(byEtag.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
			expect(byDate.status).toBe(304);
			expect(changed.status).toBe(200);
		});

		it("answers HEAD with the headers of the GET and no body", async () => {
			await using api = await boot();

			const response = await raw(api.baseUrl, "/ui/assets/index-DiwrgTda.js", {
				method: "HEAD",
			});

			expect(response.status).toBe(200);
			expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
			expect(response.headers["content-length"]).toBe(String("console.log('app')".length));
			expect(response.body).toBe("");
		});

		it("lets the options replace the rules", async () => {
			await using api = await bootModule({
				controllers: [ApiController],
				configure: (builder) =>
					builder.use(
						configureHttp({
							statics: [
								{
									prefix: "/ui/",
									directory: ui,
									noCache: ["index.html", "favicon.ico"],
									immutable: /^assets\//,
									cacheControl: "public, max-age=60",
								},
							],
						}),
					),
			});

			const cache = async (file: string) =>
				(await fetch(`${api.baseUrl}/ui/${file}`)).headers.get("cache-control");

			expect(await cache("favicon.ico")).toBe("no-cache");
			// No longer in the list.
			expect(await cache("remoteEntry.js")).toBe("public, max-age=60");
			expect(await cache("assets/logo-background.png")).toBe(
				"public, max-age=31536000, immutable",
			);
		});
	});

	describe("single-page app fallback", () => {
		it("serves index.html for a client route, so a reload works", async () => {
			await using api = await boot();

			for (const route of [
				"/ui/portfolio",
				"/ui/portfolio/42/edit",
				"/ui/portfolio/42/?tab=pnl",
			]) {
				const response = await fetch(`${api.baseUrl}${route}`, { headers: browser });
				expect(response.status, route).toBe(200);
				expect(response.headers.get("content-type")).toContain("text/html");
				expect(response.headers.get("cache-control")).toBe("no-cache");
				expect(await response.text()).toContain("the app");
			}
		});

		it("serves it to HEAD too", async () => {
			await using api = await boot();

			const response = await raw(api.baseUrl, "/ui/portfolio", {
				method: "HEAD",
				headers: browser,
			});

			expect(response.status).toBe(200);
			expect(response.headers["content-type"]).toContain("text/html");
		});

		it("keeps a missing file a 404, not the app", async () => {
			await using api = await boot();

			for (const missing of [
				"/ui/assets/gone-ABCdef12.js",
				"/ui/nope.css",
				"/ui/deep/dir/x.png",
			]) {
				const response = await fetch(`${api.baseUrl}${missing}`);
				expect(response.status, missing).toBe(404);
				expect(await response.text()).not.toContain("the app");
			}
		});

		it("does not fall back for a method other than GET or HEAD", async () => {
			await using api = await boot();

			const response = await fetch(`${api.baseUrl}/ui/portfolio`, {
				method: "POST",
				headers: browser,
			});

			expect(response.status).toBe(404);
		});

		it("can be turned off", async () => {
			await using api = await bootModule({
				controllers: [ApiController],
				configure: (builder) =>
					builder.use(
						configureHttp({
							statics: [{ prefix: "/ui/", directory: ui, spaFallback: false }],
						}),
					),
			});

			expect((await fetch(`${api.baseUrl}/ui/portfolio`, { headers: browser })).status).toBe(
				404,
			);
			expect((await fetch(`${api.baseUrl}/ui/`)).status).toBe(200);
		});

		it("never answers an API 404 with the app", async () => {
			await using api = await boot();

			const unknownApi = await fetch(`${api.baseUrl}/api/unknown`, { headers: browser });
			const unknownRoot = await fetch(`${api.baseUrl}/unknown`, { headers: browser });
			const lookalike = await fetch(`${api.baseUrl}/uix/page`, { headers: browser });

			for (const response of [unknownApi, unknownRoot, lookalike]) {
				expect(response.status).toBe(404);
				expect(await response.text()).not.toContain("the app");
			}
		});

		it("redirects the prefix without its trailing slash to the one with", async () => {
			await using api = await boot();

			const response = await fetch(`${api.baseUrl}/ui?x=1`, { redirect: "manual" });

			expect(response.status).toBe(301);
			expect(response.headers.get("location")).toBe("/ui/?x=1");
		});

		it("has no fallback to serve when the directory has no index.html", async () => {
			const bare = path.join(site, "bare");
			await mkdir(bare, { recursive: true });
			await writeFile(path.join(bare, "app.js"), "x");
			await using api = await bootModule({
				controllers: [ApiController],
				configure: (builder) =>
					builder.use(configureHttp({ statics: [{ prefix: "/ui/", directory: bare }] })),
			});

			expect((await fetch(`${api.baseUrl}/ui/route`, { headers: browser })).status).toBe(404);
			expect((await fetch(`${api.baseUrl}/ui/app.js`)).status).toBe(200);
		});
	});

	describe("outside the HTTP pipeline", () => {
		const secured = () =>
			bootModule({
				controllers: [ApiController, SecuredController],
				services: (c) =>
					c.registerSingleton(ConfigurationServiceToken, new SecretConfigService()),
				configure: (builder) =>
					builder
						.use(auth())
						.use(configureHttp({ statics: [{ prefix: "/ui/", directory: ui }] })),
			});

		it("serves the UI to an anonymous caller while an API route still says 401", async () => {
			await using api = await secured();

			expect((await fetch(`${api.baseUrl}/api/articles`)).status).toBe(401);
			expect((await fetch(`${api.baseUrl}/ui/`)).status).toBe(200);
			expect((await fetch(`${api.baseUrl}/ui/assets/index-DiwrgTda.js`)).status).toBe(200);
			expect(
				(await fetch(`${api.baseUrl}/ui/some/client/route`, { headers: browser })).status,
			).toBe(200);
		});

		it("ignores a bad token on the UI as well", async () => {
			await using api = await secured();

			const response = await fetch(`${api.baseUrl}/ui/`, {
				headers: { authorization: "Bearer not-a-token" },
			});

			expect(response.status).toBe(200);
		});

		it("still serves the API to a caller with a token", async () => {
			await using api = await secured();
			const token = await new TokenService(secretConfig).sign({
				sub: "alice",
				scope: "read:Article",
			});

			const response = await fetch(`${api.baseUrl}/api/articles`, {
				headers: { authorization: `Bearer ${token}` },
			});

			expect(response.status).toBe(200);
		});

		it("is not counted by the rate limit, while the API is", async () => {
			await using api = await bootModule({
				controllers: [ApiController],
				configure: (builder) =>
					builder.use(
						configureHttp({
							statics: [{ prefix: "/ui/", directory: ui }],
							rateLimit: { max: 3 },
						}),
					),
			});

			const ui1 = [];
			for (let i = 0; i < 10; i += 1) {
				ui1.push((await fetch(`${api.baseUrl}/ui/assets/index-DiwrgTda.js`)).status);
				ui1.push((await fetch(`${api.baseUrl}/ui/some/route`, { headers: browser })).status);
			}
			const apiStatuses = [];
			for (let i = 0; i < 5; i += 1) {
				apiStatuses.push((await fetch(`${api.baseUrl}/api/ping`)).status);
			}

			expect(new Set(ui1)).toEqual(new Set([200]));
			expect(apiStatuses).toEqual([200, 200, 200, 429, 429]);
		});

		it("keeps a caller's own rate-limit allow list working", async () => {
			await using api = await bootModule({
				controllers: [ApiController],
				configure: (builder) =>
					builder.use(
						configureHttp({
							statics: [{ prefix: "/ui/", directory: ui }],
							rateLimit: { max: 1, allowList: ["127.0.0.1"] },
						}),
					),
			});

			const statuses = [];
			for (let i = 0; i < 3; i += 1) {
				statuses.push((await fetch(`${api.baseUrl}/api/ping`)).status);
			}

			expect(statuses).toEqual([200, 200, 200]);
		});

		it("is not listed in the OpenAPI document", async () => {
			await using api = await bootModule({
				controllers: [ApiController],
				configure: (builder) =>
					builder.use(
						configureHttp({
							statics: [{ prefix: "/ui/", directory: ui }],
							openApi: { info: { title: "t", version: "1" } },
						}),
					),
			});

			const document = (await (
				await fetch(`${api.baseUrl}/openapi.json`)
			).json()) as OpenApiDocument;

			expect(Object.keys(document.paths)).toEqual(["/api/ping"]);
		});

		it("still sends the security headers", async () => {
			await using api = await boot();

			const response = await fetch(`${api.baseUrl}/ui/`);

			expect(response.headers.get("x-content-type-options")).toBe("nosniff");
		});
	});

	describe("security", () => {
		it("never leaves the directory, however the dots are written", async () => {
			await using api = await boot();
			const attempts = [
				"/ui/../secret.txt",
				"/ui/..%2fsecret.txt",
				"/ui/%2e%2e/secret.txt",
				"/ui/%2e%2e%2fsecret.txt",
				"/ui/%2E%2E%2Fsecret.txt",
				"/ui/..%5csecret.txt",
				"/ui/assets/../../secret.txt",
				"/ui/assets/%2e%2e/%2e%2e/secret.txt",
				"/ui/....//secret.txt",
				"/ui/%252e%252e%252fsecret.txt",
				"/ui/..%00/secret.txt",
				"/ui//../secret.txt",
				"/ui/../ui-sibling.txt",
				"/ui/%2e%2e/ui-sibling.txt",
			];

			for (const attempt of attempts) {
				const response = await raw(api.baseUrl, attempt);
				expect(response.body, attempt).not.toContain("outside the root");
				expect(response.body, attempt).not.toContain("sibling");
				expect([400, 403, 404], attempt).toContain(response.status);
			}
		});

		it("does not serve dotfiles or anything in a dot folder", async () => {
			await using api = await boot();

			for (const hidden of ["/ui/.env", "/ui/.hidden/key.txt", "/ui/%2eenv"]) {
				const response = await fetch(`${api.baseUrl}${hidden}`);
				expect(response.status, hidden).toBe(404);
				const body = await response.text();
				expect(body).not.toContain("SECRET");
				expect(body).not.toContain("the app");
			}
		});

		it("does not list a directory", async () => {
			await using api = await boot();

			for (const directory of ["/ui/assets/", "/ui/assets", "/ui/empty-dir/"]) {
				const response = await fetch(`${api.baseUrl}${directory}`);
				const body = await response.text();
				expect(body, directory).not.toContain("index-DiwrgTda.js");
				expect(body, directory).not.toContain("logo-background.png");
			}
		});
	});

	describe("where the directory is", () => {
		it("is resolved from the process working directory", async () => {
			vi.spyOn(process, "cwd").mockReturnValue(site);
			await using api = await bootModule({
				controllers: [ApiController],
				configure: (builder) =>
					builder.use(configureHttp({ statics: [{ prefix: "/ui/", directory: "ui" }] })),
			});

			const response = await fetch(`${api.baseUrl}/ui/`);

			expect(response.status).toBe(200);
		});

		it("stops the app at start when it is missing, outside development", async () => {
			vi.stubEnv("NODE_ENV", "production");

			const boot = bootModule({
				controllers: [ApiController],
				configure: (builder) =>
					builder.use(
						configureHttp({ statics: [{ prefix: "/ui/", directory: "no-such-ui-build" }] }),
					),
			});

			await expect(boot).rejects.toThrow(
				/no-such-ui-build.*does not exist.*Build the UI first/s,
			);
		});

		it("lets the API boot with a warning in development, and the prefix answers 404", async () => {
			vi.stubEnv("NODE_ENV", "development");
			await using api = await bootModule({
				controllers: [ApiController],
				configure: (builder) =>
					builder.use(
						configureHttp({ statics: [{ prefix: "/ui/", directory: "no-such-ui-build" }] }),
					),
			});

			expect((await fetch(`${api.baseUrl}/api/ping`)).status).toBe(200);
			expect((await fetch(`${api.baseUrl}/ui/`)).status).toBe(404);
		});

		it("follows onMissingDirectory over the environment", async () => {
			vi.stubEnv("NODE_ENV", "production");
			await using api = await bootModule({
				controllers: [ApiController],
				configure: (builder) =>
					builder.use(
						configureHttp({
							statics: [
								{ prefix: "/ui/", directory: "no-such-ui-build", onMissingDirectory: "warn" },
							],
						}),
					),
			});

			expect((await fetch(`${api.baseUrl}/api/ping`)).status).toBe(200);
		});

		it("refuses an empty prefix", () => {
			const mount = bootModule({
				controllers: [ApiController],
				configure: (builder) =>
					builder.use(configureHttp({ statics: [{ prefix: "", directory: ui }] })),
			});

			return expect(mount).rejects.toThrow(/needs a prefix/);
		});

		it("can serve more than one UI", async () => {
			await using api = await bootModule({
				controllers: [ApiController],
				configure: (builder) =>
					builder.use(
						configureHttp({
							statics: [
								{ prefix: "/ui/", directory: ui },
								{ prefix: "/admin/", directory: ui },
							],
						}),
					),
			});

			expect((await fetch(`${api.baseUrl}/ui/`)).status).toBe(200);
			expect(
				(await fetch(`${api.baseUrl}/admin/some/route`, { headers: browser })).status,
			).toBe(200);
		});
	});

	describe("served from the root", () => {
		const bootRoot = (options?: StaticOptions) =>
			bootModule({
				controllers: [ApiController, PortfolioController, SecuredController],
				services: (c) =>
					c.registerSingleton(ConfigurationServiceToken, new SecretConfigService()),
				configure: (builder) =>
					builder
						.use(auth())
						.use(health())
						.use(
							configureHttp({
								statics: [{ prefix: "/", directory: ui, ...options }],
								openApi: { info: { title: "t", version: "1" } },
							}),
						),
			});
		const json = { accept: "application/json" };
		const notFound = async (response: Response) => {
			expect(response.status).toBe(404);
			expect(response.headers.get("content-type")).toContain("application/json");
			const body = (await response.json()) as {
				message: string;
				error: string;
				statusCode: number;
			};
			expect(body.error).toBe("Not Found");
			expect(body.statusCode).toBe(404);
			return body;
		};

		it("serves GET /, HEAD / and an asset from the root", async () => {
			await using api = await bootRoot();

			const index = await fetch(`${api.baseUrl}/`);
			const head = await raw(api.baseUrl, "/", { method: "HEAD" });
			const asset = await fetch(`${api.baseUrl}/assets/index-DiwrgTda.js`);

			expect(index.status).toBe(200);
			expect(await index.text()).toContain("the app");
			expect(head.status).toBe(200);
			expect(head.headers["content-type"]).toContain("text/html");
			expect(head.body).toBe("");
			expect(asset.status).toBe(200);
			expect(await asset.text()).toBe("console.log('app')");
		});

		it("serves index.html to a browser navigation to an unknown client route", async () => {
			await using api = await bootRoot();

			for (const route of ["/some/client/route", "/portfolio/42?tab=pnl", "/lpx"]) {
				const response = await fetch(`${api.baseUrl}${route}`, { headers: browser });
				expect(response.status, route).toBe(200);
				expect(response.headers.get("content-type")).toContain("text/html");
				expect(await response.text()).toContain("the app");
			}
			const head = await raw(api.baseUrl, "/some/route", {
				method: "HEAD",
				headers: browser,
			});
			expect(head.status).toBe(200);
		});

		it("gives the JSON 404 to a request that does not ask for html", async () => {
			await using api = await bootRoot();

			for (const headers of [json, { accept: "*/*" }, {}, { accept: "text/*" }]) {
				const response = await fetch(`${api.baseUrl}/some/client/route`, { headers });
				const body = await notFound(response);
				expect(body.message).toBe("Route GET:/some/client/route not found");
			}
		});

		it("answers the same 404 as an app with no UI", async () => {
			await using plain = await bootModule({ controllers: [ApiController] });
			await using api = await bootRoot();
			const route = "/some/client/route";

			const without = await fetch(`${plain.baseUrl}${route}`, { headers: json });
			const withRoot = await fetch(`${api.baseUrl}${route}`, { headers: json });

			expect(withRoot.status).toBe(without.status);
			expect(await withRoot.text()).toBe(await without.text());
			expect(withRoot.headers.get("content-type")).toBe(without.headers.get("content-type"));
		});

		it("never answers a path under a controller route with the app, even for a browser", async () => {
			await using api = await bootRoot();

			for (const route of ["/lp/portfolo", "/lp", "/lp/a/b", "/api/unknown", "/health/x"]) {
				await notFound(await fetch(`${api.baseUrl}${route}`, { headers: browser }));
			}
		});

		it("keeps /health, a secured route, a plain route and OpenAPI working", async () => {
			await using api = await bootRoot();

			expect((await fetch(`${api.baseUrl}/health`, { headers: browser })).status).toBe(200);
			expect((await fetch(`${api.baseUrl}/lp/portfolio`, { headers: browser })).status).toBe(
				200,
			);
			expect((await fetch(`${api.baseUrl}/api/articles`, { headers: browser })).status).toBe(
				401,
			);
			const spec = await fetch(`${api.baseUrl}/openapi.json`, { headers: browser });
			expect(spec.status).toBe(200);
			expect(spec.headers.get("content-type")).toContain("application/json");
		});

		it("gives a missing asset and a dotfile a 404, not the app", async () => {
			await using api = await bootRoot();

			for (const missing of [
				"/assets/gone-ABCdef12.js",
				"/nope.css",
				"/.env",
				"/.hidden/key.txt",
			]) {
				const response = await fetch(`${api.baseUrl}${missing}`, { headers: browser });
				expect(response.status, missing).toBe(404);
				expect(await response.text()).not.toContain("the app");
			}
		});

		it("gives POST to an unknown path the JSON 404", async () => {
			await using api = await bootRoot();

			const response = await fetch(`${api.baseUrl}/some/route`, {
				method: "POST",
				headers: browser,
			});

			const body = await notFound(response);
			expect(body.message).toBe("Route POST:/some/route not found");
		});

		it("never answers an excluded path, as a file or as the app", async () => {
			await using api = await bootRoot({ exclude: ["/private/**", "/assets/*.png"] });

			await notFound(await fetch(`${api.baseUrl}/private/page`, { headers: browser }));
			await notFound(await fetch(`${api.baseUrl}/private`, { headers: browser }));
			await notFound(await fetch(`${api.baseUrl}/assets/logo-background.png`));
			await notFound(await fetch(`${api.baseUrl}/%70rivate/page`, { headers: browser }));
			expect((await fetch(`${api.baseUrl}/public/page`, { headers: browser })).status).toBe(
				200,
			);
			expect((await fetch(`${api.baseUrl}/assets/index-DiwrgTda.js`)).status).toBe(200);
		});

		it("sets the cache headers as under a prefix", async () => {
			await using api = await bootRoot();

			const cache = async (file: string, init?: RequestInit) =>
				(await fetch(`${api.baseUrl}${file}`, init)).headers.get("cache-control");

			expect(await cache("/")).toBe("no-cache");
			expect(await cache("/some/route", { headers: browser })).toBe("no-cache");
			expect(await cache("/remoteEntry.js")).toBe("no-cache");
			expect(await cache("/assets/index-DiwrgTda.js")).toBe(
				"public, max-age=31536000, immutable",
			);
			expect(await cache("/favicon.ico")).toBe("public, max-age=0, must-revalidate");
		});

		it("exempts only the static route from the rate limit", async () => {
			await using api = await bootModule({
				controllers: [ApiController, PortfolioController],
				configure: (builder) =>
					builder.use(
						configureHttp({
							statics: [{ prefix: "/", directory: ui }],
							rateLimit: { max: 2 },
						}),
					),
			});

			const files = [];
			for (let i = 0; i < 8; i += 1) {
				files.push((await fetch(`${api.baseUrl}/assets/index-DiwrgTda.js`)).status);
				files.push((await fetch(`${api.baseUrl}/some/route`, { headers: browser })).status);
			}
			const apiStatuses = [];
			for (let i = 0; i < 4; i += 1) {
				apiStatuses.push((await fetch(`${api.baseUrl}/api/ping`)).status);
			}

			expect(new Set(files)).toEqual(new Set([200]));
			expect(apiStatuses).toEqual([200, 200, 429, 429]);
		});

		it("blocks path traversal", async () => {
			await using api = await bootRoot();
			const attempts = [
				"/../secret.txt",
				"/..%2fsecret.txt",
				"/%2e%2e/secret.txt",
				"/%2e%2e%2f%2e%2e/secret.txt",
				"/assets/../../secret.txt",
				"/%252e%252e%252fsecret.txt",
			];

			for (const attempt of attempts) {
				const response = await raw(api.baseUrl, attempt, { headers: browser });
				expect(response.body, attempt).not.toContain("outside the root");
				expect([200, 400, 403, 404], attempt).toContain(response.status);
			}
		});

		it("lets the more specific of two mounts win", async () => {
			const admin = path.join(site, "admin-ui");
			await mkdir(admin, { recursive: true });
			await writeFile(path.join(admin, "index.html"), "<title>the admin</title>");
			await using api = await bootModule({
				controllers: [ApiController],
				configure: (builder) =>
					builder.use(
						configureHttp({
							statics: [
								{ prefix: "/", directory: ui },
								{ prefix: "/admin/", directory: admin },
							],
						}),
					),
			});

			const text = async (route: string) =>
				(await fetch(`${api.baseUrl}${route}`, { headers: browser })).text();

			expect(await text("/")).toContain("the app");
			expect(await text("/some/route")).toContain("the app");
			expect(await text("/admin/")).toContain("the admin");
			expect(await text("/admin/users/3")).toContain("the admin");
		});

		it("still redirects a non-root prefix without its slash, next to a root mount", async () => {
			const admin = path.join(site, "admin-ui");
			await mkdir(admin, { recursive: true });
			await writeFile(path.join(admin, "index.html"), "<title>the admin</title>");
			await using api = await bootModule({
				controllers: [ApiController],
				configure: (builder) =>
					builder.use(
						configureHttp({
							statics: [
								{ prefix: "/", directory: ui },
								{ prefix: "/admin/", directory: admin },
							],
						}),
					),
			});

			const response = await fetch(`${api.baseUrl}/admin?x=1`, { redirect: "manual" });

			expect(response.status).toBe(301);
			expect(response.headers.get("location")).toBe("/admin/?x=1");
		});

		it("can switch the fallback off, keeping the files", async () => {
			await using api = await bootRoot({ spaFallback: false });

			expect((await fetch(`${api.baseUrl}/`)).status).toBe(200);
			await notFound(await fetch(`${api.baseUrl}/some/route`, { headers: browser }));
		});
	});

	describe("the fallback under a prefix decides by what is asking", () => {
		it("gives a request that does not ask for html the JSON 404", async () => {
			await using api = await boot();

			const asJson = await fetch(`${api.baseUrl}/ui/portfolio`, {
				headers: { accept: "application/json" },
			});
			const asAny = await fetch(`${api.baseUrl}/ui/portfolio`);

			expect(asJson.status).toBe(404);
			expect(asAny.status).toBe(404);
			expect(await asAny.text()).not.toContain("the app");
		});
	});
});
