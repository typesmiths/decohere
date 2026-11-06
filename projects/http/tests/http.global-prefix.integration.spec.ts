import { configureHttp } from "../src/http/http.plugin.js";
import { health } from "../src/health/health.plugin.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Controller, Get } from "../src/index.js";
import type { OpenApiDocument } from "../src/openapi/openapi.types.js";
import { bootModule } from "../src/testing/index.js";

// Static files are read by the real server from real disk.
vi.unmock("fs");
vi.unmock("fs/promises");
vi.unmock("node:fs");
vi.unmock("node:fs/promises");

@Controller({ prefix: "/lp" })
class PortfolioController {
	@Get("/portfolio")
	public portfolio() {
		return { positions: [] };
	}
}

@Controller({ prefix: "/" })
class PingController {
	@Get("/ping")
	public ping() {
		return { pong: true };
	}
}

@Controller({ prefix: "/webhooks", globalPrefix: false })
class WebhookController {
	@Get("/:source")
	public receive() {
		return { received: true };
	}
}

/** Declares `/health` itself: only the opt-out moves a route, never its name. */
@Controller({ prefix: "/" })
class OwnHealthController {
	@Get("/health")
	public health() {
		return { mine: true };
	}
}

/** What a browser sends when it navigates: the SPA fallback only answers this kind of request. */
const browser = { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8" };

let ui: string;

beforeAll(async () => {
	ui = await mkdtemp(path.join(tmpdir(), "http-prefix-"));
	await writeFile(path.join(ui, "index.html"), "<!doctype html><title>the app</title>");
});

afterAll(async () => {
	await rm(ui, { recursive: true, force: true });
});

type Configure = NonNullable<Parameters<typeof bootModule>[0]["configure"]>;
type TestBuilder = Parameters<Configure>[0];

function boot(configure: Configure) {
	return bootModule({ controllers: [PortfolioController, PingController], configure });
}

/** Status of a GET. The body is read so a streamed file never holds up stopping the app. */
async function status(
	api: { baseUrl: string },
	url: string,
	headers?: Record<string, string>,
) {
	const response = await fetch(`${api.baseUrl}${url}`, { headers });
	await response.arrayBuffer();
	return response.status;
}

describe("the global prefix and the probes", () => {
	it("keeps /health and /ready at the root, and prefixes the controllers", async () => {
		await using api = await boot((b) =>
			b.use(health()).use(configureHttp({ globalPrefix: "/api" })),
		);

		expect(await status(api, "/health")).toBe(200);
		expect(await status(api, "/ready")).toBe(200);
		expect(await status(api, "/api/health")).toBe(404);
		expect(await status(api, "/api/ready")).toBe(404);
		expect(await status(api, "/api/lp/portfolio")).toBe(200);
		expect(await status(api, "/api/ping")).toBe(200);
		expect(await status(api, "/lp/portfolio")).toBe(404);
		expect(await status(api, "/ping")).toBe(404);
	});

	it("keeps the probes at the root whichever order the builder is called in", async () => {
		await using api = await boot((b) =>
			b.use(configureHttp({ globalPrefix: "/api" })).use(health()),
		);

		expect(await status(api, "/health")).toBe(200);
		expect(await status(api, "/api/health")).toBe(404);
	});

	it("leaves a controller that opts out unprefixed, parameters included", async () => {
		await using api = await bootModule({
			controllers: [PortfolioController, WebhookController],
			configure: (b) => b.use(configureHttp({ globalPrefix: "/api" })),
		});

		expect(await status(api, "/webhooks/stripe")).toBe(200);
		expect(await status(api, "/api/webhooks/stripe")).toBe(404);
		expect(await status(api, "/api/lp/portfolio")).toBe(200);
	});

	it("prefixes a controller that declares /health itself: the path alone moves nothing", async () => {
		await using api = await bootModule({
			controllers: [OwnHealthController],
			configure: (b) => b.use(configureHttp({ globalPrefix: "/api" })),
		});

		expect(await status(api, "/api/health")).toBe(200);
		expect(await status(api, "/health")).toBe(404);
	});

	it("puts the probes under the prefix with underGlobalPrefix", async () => {
		await using api = await boot((b) =>
			b.use(health({ underGlobalPrefix: true })).use(configureHttp({ globalPrefix: "/api" })),
		);

		expect(await status(api, "/api/health")).toBe(200);
		expect(await status(api, "/api/ready")).toBe(200);
		expect(await status(api, "/health")).toBe(404);
		expect(await status(api, "/ready")).toBe(404);
	});

	it("applies underGlobalPrefix whichever order the builder is called in", async () => {
		await using api = await boot((b) =>
			b.use(configureHttp({ globalPrefix: "/api" })).use(health({ underGlobalPrefix: true })),
		);

		expect(await status(api, "/api/health")).toBe(200);
		expect(await status(api, "/health")).toBe(404);
	});

	it("serves the probes at the root with underGlobalPrefix and no prefix", async () => {
		await using api = await boot((b) => b.use(health({ underGlobalPrefix: true })));

		expect(await status(api, "/health")).toBe(200);
		expect(await status(api, "/ready")).toBe(200);
	});

	it("keeps the OpenAPI path where it was, and lists the prefixed routes", async () => {
		await using api = await boot((b) =>
			b.use(health()).use(
				configureHttp({
					globalPrefix: "/api",
					openApi: { info: { title: "t", version: "1" } },
				}),
			),
		);

		expect(await status(api, "/openapi.json")).toBe(200);
		expect(await status(api, "/api/openapi.json")).toBe(404);
		const doc = (await (await fetch(`${api.baseUrl}/openapi.json`)).json()) as OpenApiDocument;
		expect(Object.keys(doc.paths)).toContain("/api/lp/portfolio");
	});

	it("changes nothing without a global prefix", async () => {
		await using api = await boot((b) => b.use(health()));

		expect(await status(api, "/health")).toBe(200);
		expect(await status(api, "/ready")).toBe(200);
		expect(await status(api, "/lp/portfolio")).toBe(200);
		expect(await status(api, "/ping")).toBe(200);
	});
});

describe("the static fallback with a global prefix", () => {
	const withUi = (b: TestBuilder) =>
		b
			.use(health())
			.use(configureHttp({ statics: [{ prefix: "/", directory: ui }], globalPrefix: "/api" }));

	it("gives the app to a UI route that shares a first segment with a prefixed controller", async () => {
		await using api = await boot(withUi);

		const page = await fetch(`${api.baseUrl}/lp/positions`, { headers: browser });
		expect(page.status).toBe(200);
		expect(await page.text()).toContain("the app");
	});

	it("keeps the JSON 404 at and below a route outside the prefix, even to a browser", async () => {
		await using api = await bootModule({
			controllers: [PortfolioController, WebhookController],
			configure: (b) =>
				b
					.use(health())
					.use(
						configureHttp({ statics: [{ prefix: "/", directory: ui }], globalPrefix: "/api" }),
					),
		});

		for (const url of ["/health/x", "/ready/", "/webhooks", "/webhooks/stripe/x"]) {
			const response = await fetch(`${api.baseUrl}${url}`, { headers: browser });
			expect(response.status, url).toBe(404);
			expect(await response.text()).not.toContain("the app");
		}
		// The routes themselves answer, and names that only start the same get the app.
		expect(await status(api, "/health", browser)).toBe(200);
		expect(await status(api, "/webhooks/stripe", browser)).toBe(200);
		expect(await status(api, "/healthy", browser)).toBe(200);
	});

	it("gives the app to a UI route that shares a first segment with the prefix", async () => {
		await using api = await boot((b) =>
			b.use(
				configureHttp({ statics: [{ prefix: "/", directory: ui }], globalPrefix: "/api/v1" }),
			),
		);

		const page = await fetch(`${api.baseUrl}/api/docs`, { headers: browser });
		expect(page.status).toBe(200);
		expect(await page.text()).toContain("the app");
		expect(await status(api, "/api/v1/nothing", browser)).toBe(404);
	});

	it("keeps the JSON 404 for any path under the prefix, even to a browser", async () => {
		await using api = await boot(withUi);

		for (const url of ["/api", "/api/", "/api/lp/portfolo", "/api/nothing/here"]) {
			const response = await fetch(`${api.baseUrl}${url}`, { headers: browser });
			expect(response.status).toBe(404);
			expect(await response.text()).not.toContain("the app");
		}
	});

	it("keeps the JSON 404 under the prefix when no controller is under it", async () => {
		await using api = await bootModule({
			controllers: [],
			configure: (b) =>
				b.use(
					configureHttp({ statics: [{ prefix: "/", directory: ui }], globalPrefix: "/api" }),
				),
		});

		expect(await status(api, "/api/anything", browser)).toBe(404);
		expect(await status(api, "/anything", browser)).toBe(200);
	});

	it("does not treat a name that only starts with the prefix as the API", async () => {
		await using api = await boot(withUi);

		const page = await fetch(`${api.baseUrl}/apiary`, { headers: browser });
		expect(page.status).toBe(200);
		expect(await page.text()).toContain("the app");
	});

	it("keeps the OpenAPI path out of the fallback", async () => {
		await using api = await boot((b) =>
			withUi(b).use(
				configureHttp({
					openApi: {
						info: { title: "t", version: "1" },
						path: "/spec/openapi.json",
					},
				}),
			),
		);

		expect(await status(api, "/spec/openapi.json", browser)).toBe(200);
		expect(await status(api, "/spec/openapi.json/more", browser)).toBe(404);
		expect(await status(api, "/elsewhere", browser)).toBe(200);
	});

	it("keeps the other rules: method, extension, Accept and exclude", async () => {
		await using api = await boot((b) =>
			b.use(
				configureHttp({
					statics: [{ prefix: "/", directory: ui, exclude: ["/docs/**"] }],
					globalPrefix: "/api",
				}),
			),
		);
		const call = (method: string) =>
			fetch(`${api.baseUrl}/lp/positions`, { method, headers: browser }).then((r) => r.status);

		expect(await status(api, "/lp/positions", { accept: "application/json" })).toBe(404);
		expect(await status(api, "/lp/positions")).toBe(404);
		expect(await status(api, "/lp/gone.js", browser)).toBe(404);
		expect(await status(api, "/docs/x", browser)).toBe(404);
		expect(await call("POST")).toBe(404);
		expect(await call("HEAD")).toBe(200);
	});

	it("still prefixes the controllers and keeps the probes at the root", async () => {
		await using api = await boot(withUi);

		expect(await status(api, "/api/lp/portfolio")).toBe(200);
		expect(await status(api, "/health")).toBe(200);
		expect(await status(api, "/")).toBe(200);
	});

	it("keeps the first-segment rule without a global prefix", async () => {
		await using api = await boot((b) =>
			b.use(health()).use(configureHttp({ statics: [{ prefix: "/", directory: ui }] })),
		);

		expect(await status(api, "/lp/positions", browser)).toBe(404);
		expect(await status(api, "/health/x", browser)).toBe(404);
		expect(await status(api, "/portfolio", browser)).toBe(200);
		expect(await status(api, "/lpx", browser)).toBe(200);
	});
});
