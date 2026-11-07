import { configureHttp } from "../src/http/http.plugin.js";
import { auth } from "../src/auth/auth.plugin.js";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";
import { setTimeout as sleep } from "node:timers/promises";
import {
	ConfigurationServiceToken,
	type IConfigurationService,
} from "@decohere/core/configuration";
import type { Constructable } from "@decohere/core/reflection";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthConfig } from "../src/auth/auth.config.js";
import {
	Authorize,
	Controller,
	Get,
	Header,
	Signal,
	Sse,
	type SseStream,
} from "../src/index.js";
import { HttpError } from "../src/routing/http.types.js";
import { bootModule } from "../src/testing/index.js";
import type { Builder } from "@decohere/core/hosting";

// Static files are read by the real server from real disk (the suite's fs is an in-memory fake).
vi.unmock("fs");
vi.unmock("fs/promises");
vi.unmock("node:fs");
vi.unmock("node:fs/promises");

class SecretConfigService implements IConfigurationService {
	public get dataSources() {
		return [];
	}
	public async get<T extends object>(type: Constructable<T> | string): Promise<T> {
		if (Object.is(type, AuthConfig)) {
			return Object.assign(new AuthConfig(), {
				secret: "super-secret-key-that-is-long-enough-for-hs256",
				issuer: "test-issuer",
				audience: "test-audience",
			}) as unknown as T;
		}
		return {} as T;
	}
}

const bigRows = Array.from({ length: 200 }, (_, i) => ({ id: i, name: `item number ${i}` }));
const smallBody = { ok: true };
const bigText = "The quick brown fox jumps over the lazy dog. ".repeat(100);

@Controller({ prefix: "/api" })
class ApiController {
	@Get("/big")
	public big() {
		return bigRows;
	}

	@Get("/small")
	public small() {
		return smallBody;
	}

	@Header("content-type", "image/png")
	@Get("/image")
	public image() {
		return bigText;
	}

	@Header("content-type", "text/plain")
	@Header("content-encoding", "x-custom")
	@Get("/encoded")
	public encoded() {
		return bigText;
	}

	@Header("content-type", "application/octet-stream")
	@Get("/binary")
	public binary() {
		return bigText;
	}

	@Header("content-type", "text/plain")
	@Get("/text")
	public text() {
		return bigText;
	}

	@Get("/boom")
	public boom() {
		// An error body above the threshold: the exception filter echoes the message.
		throw new HttpError(bigText, 400);
	}
}

@Controller({ prefix: "/api" })
class SecuredController {
	@Authorize("read", "Article")
	@Get("/secured")
	public secured() {
		return { secret: true };
	}
}

@Controller({ prefix: "/feed" })
class FeedController {
	/** Sends one event at once, then waits: a compressed stream would hold the first one back. */
	@Sse({ heartbeatMs: 0 })
	@Get("/live")
	public async *live(@Signal() signal: AbortSignal): SseStream {
		yield { id: "1", data: bigText };
		await sleep(30_000, undefined, { signal }).catch(() => undefined);
		yield { id: "2", data: "never reached in the test" };
	}
}

type Wire = {
	status: number;
	headers: Record<string, string | string[] | undefined>;
	/** The bytes as they crossed the wire, not decoded. */
	raw: Buffer;
	/** The body after undoing any `Content-Encoding`. */
	body: string;
};

function decode(encoding: string | string[] | undefined, raw: Buffer): string {
	if (raw.length === 0) return "";
	if (encoding === "br") return brotliDecompressSync(raw).toString("utf8");
	if (encoding === "gzip") return gunzipSync(raw).toString("utf8");
	if (encoding === "deflate") return inflateSync(raw).toString("utf8");
	return raw.toString("utf8");
}

/** A request that sends exactly the headers given and reads the body undecoded. Node's `fetch` negotiates and decodes by itself. */
function wire(
	baseUrl: string,
	pathname: string,
	headers: Record<string, string> = {},
	method = "GET",
): Promise<Wire> {
	const url = new URL(baseUrl);
	return new Promise((resolve, reject) => {
		const req = request(
			{ host: url.hostname, port: url.port, path: pathname, method, headers },
			(res) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => {
					const raw = Buffer.concat(chunks);
					resolve({
						status: res.statusCode ?? 0,
						headers: res.headers,
						raw,
						body: decode(res.headers["content-encoding"], raw),
					});
				});
			},
		);
		req.on("error", reject);
		req.end();
	});
}

function boot(
	configure: (builder: Builder) => unknown = () => undefined,
	extraControllers: Constructable[] = [],
) {
	return bootModule({
		controllers: [ApiController, FeedController, ...extraControllers],
		services: (c) => c.registerSingleton(ConfigurationServiceToken, new SecretConfigService()),
		configure,
	});
}

const bigJson = JSON.stringify(bigRows);

describe("response compression", () => {
	describe("negotiation", () => {
		it("sends brotli to a client that accepts it", async () => {
			await using api = await boot();

			const response = await wire(api.baseUrl, "/api/big", { "accept-encoding": "br, gzip" });

			expect(response.status).toBe(200);
			expect(response.headers["content-encoding"]).toBe("br");
			expect(response.raw.length).toBeLessThan(bigJson.length / 2);
			expect(JSON.parse(response.body)).toEqual(bigRows);
		});

		it("sends gzip to a client that only accepts gzip", async () => {
			await using api = await boot();

			const response = await wire(api.baseUrl, "/api/big", { "accept-encoding": "gzip" });

			expect(response.headers["content-encoding"]).toBe("gzip");
			expect(JSON.parse(response.body)).toEqual(bigRows);
		});

		it("does not offer deflate unless asked to", async () => {
			await using api = await boot();

			const response = await wire(api.baseUrl, "/api/big", { "accept-encoding": "deflate" });

			expect(response.headers["content-encoding"]).toBeUndefined();
			expect(response.body).toBe(bigJson);
		});

		it("leaves the body alone when the client sends no Accept-Encoding", async () => {
			await using api = await boot();

			const response = await wire(api.baseUrl, "/api/big");

			expect(response.headers["content-encoding"]).toBeUndefined();
			expect(response.body).toBe(bigJson);
		});

		it("leaves the body alone when the client asks for identity", async () => {
			await using api = await boot();

			const response = await wire(api.baseUrl, "/api/big", { "accept-encoding": "identity" });

			expect(response.headers["content-encoding"]).toBeUndefined();
			expect(response.body).toBe(bigJson);
		});

		it("is transparent to a normal client (fetch decodes it)", async () => {
			await using api = await boot();

			const response = await fetch(`${api.baseUrl}/api/big`);

			expect(await response.json()).toEqual(bigRows);
		});

		it("compresses text, not only JSON", async () => {
			await using api = await boot();

			const response = await wire(api.baseUrl, "/api/text", { "accept-encoding": "gzip" });

			expect(response.headers["content-encoding"]).toBe("gzip");
			expect(response.body).toBe(bigText);
		});
	});

	describe("what is not compressed", () => {
		it("sends a body under the threshold as it is", async () => {
			await using api = await boot();

			const response = await wire(api.baseUrl, "/api/small", {
				"accept-encoding": "br, gzip",
			});

			expect(response.headers["content-encoding"]).toBeUndefined();
			expect(JSON.parse(response.body)).toEqual(smallBody);
		});

		it("does not compress already-compressed media", async () => {
			await using api = await boot();

			const response = await wire(api.baseUrl, "/api/image", {
				"accept-encoding": "br, gzip",
			});

			expect(response.headers["content-type"]).toBe("image/png");
			expect(response.headers["content-encoding"]).toBeUndefined();
			expect(response.body).toBe(bigText);
		});

		it("passes through a response that already has a Content-Encoding", async () => {
			await using api = await boot();

			const response = await wire(api.baseUrl, "/api/encoded", {
				"accept-encoding": "br, gzip",
			});

			expect(response.headers["content-encoding"]).toBe("x-custom");
			expect(response.raw.toString("utf8")).toBe(bigText);
		});
	});

	describe("headers", () => {
		it("sets Vary: Accept-Encoding on a compressed response", async () => {
			await using api = await boot();

			const compressed = await wire(api.baseUrl, "/api/big", { "accept-encoding": "gzip" });

			expect(compressed.headers.vary).toMatch(/accept-encoding/i);
		});

		it("does not add Vary to a response that is not compressed", async () => {
			await using api = await boot();

			const response = await wire(api.baseUrl, "/api/image", { "accept-encoding": "gzip" });

			expect(response.headers.vary).toBeUndefined();
		});

		it("keeps the helmet, CORS and rate-limit headers on a compressed response", async () => {
			await using api = await boot((builder) =>
				builder.use(configureHttp({ cors: { origin: "https://app.example.com" } })),
			);

			const response = await wire(api.baseUrl, "/api/big", {
				"accept-encoding": "gzip",
				origin: "https://app.example.com",
			});

			expect(response.headers["content-encoding"]).toBe("gzip");
			expect(response.headers["x-content-type-options"]).toBe("nosniff");
			expect(response.headers["access-control-allow-origin"]).toBe("https://app.example.com");
			expect(response.headers["x-ratelimit-limit"]).toBeDefined();
			expect(response.headers.vary).toMatch(/accept-encoding/i);
		});
	});

	describe("HEAD and errors", () => {
		it("answers HEAD with its headers and no body", async () => {
			await using api = await boot();

			const response = await wire(
				api.baseUrl,
				"/api/big",
				{ "accept-encoding": "gzip" },
				"HEAD",
			);

			// Fastify builds a HEAD reply in a hook that runs before the compression plugin's, so
			// a HEAD is answered uncompressed (with the plain Content-Length) and without Vary.
			expect(response.status).toBe(200);
			expect(response.headers["content-type"]).toContain("application/json");
			expect(response.headers["content-encoding"]).toBeUndefined();
			expect(response.raw.length).toBe(0);
		});

		it("still answers an unauthorised request with 401", async () => {
			await using api = await boot((builder) => builder.use(auth()), [SecuredController]);

			const response = await wire(api.baseUrl, "/api/secured", {
				"accept-encoding": "br, gzip",
			});

			expect(response.status).toBe(401);
			expect(JSON.parse(response.body)).toBeTypeOf("object");
		});

		it("compresses a large error body too", async () => {
			await using api = await boot();

			const response = await wire(api.baseUrl, "/api/boom", { "accept-encoding": "gzip" });

			expect(response.status).toBe(400);
			expect(response.headers["content-encoding"]).toBe("gzip");
			expect(response.body.length).toBeGreaterThan(1024);
		});

		it("keeps the JSON 404 for an unknown route", async () => {
			await using api = await boot();

			const response = await wire(api.baseUrl, "/nope", { "accept-encoding": "gzip" });

			expect(response.status).toBe(404);
			expect(JSON.parse(response.body)).toBeTypeOf("object");
		});
	});

	describe("server-sent events", () => {
		it("does not compress a stream by default, and delivers the first event while the producer is still running", async () => {
			await using api = await boot();

			const started = Date.now();
			const read = await api.readEvents("/feed/live", {
				count: 1,
				headers: { "accept-encoding": "br, gzip" },
				timeoutMs: 3000,
			});

			expect(read.status).toBe(200);
			expect(read.headers.get("content-type")).toContain("text/event-stream");
			expect(read.headers.get("content-encoding")).toBeNull();
			expect(read.events).toEqual([{ id: "1", data: bigText }]);
			// The producer sleeps for 30 s after the first event. Compression would hold it back.
			expect(Date.now() - started).toBeLessThan(2000);
		});
	});

	describe("options", () => {
		it("is off with compression: false", async () => {
			await using api = await boot((builder) =>
				builder.use(configureHttp({ compression: false })),
			);

			const response = await wire(api.baseUrl, "/api/big", { "accept-encoding": "br, gzip" });

			expect(response.headers["content-encoding"]).toBeUndefined();
			expect(response.headers.vary).toBeUndefined();
			expect(response.body).toBe(bigJson);
		});

		it("compresses by default with no compression options", async () => {
			await using api = await boot((builder) =>
				builder.use(configureHttp({ compression: {} })),
			);

			const response = await wire(api.baseUrl, "/api/big", { "accept-encoding": "gzip" });

			expect(response.headers["content-encoding"]).toBe("gzip");
		});

		it("honours a custom threshold", async () => {
			await using api = await boot((builder) =>
				builder.use(configureHttp({ compression: { threshold: 5 } })),
			);

			const small = await wire(api.baseUrl, "/api/small", { "accept-encoding": "gzip" });
			expect(small.headers["content-encoding"]).toBe("gzip");

			await using high = await boot((builder) =>
				builder.use(configureHttp({ compression: { threshold: 1_000_000 } })),
			);
			const big = await wire(high.baseUrl, "/api/big", { "accept-encoding": "gzip" });
			expect(big.headers["content-encoding"]).toBeUndefined();
		});

		it("honours custom encodings and their order", async () => {
			await using gzipOnly = await boot((builder) =>
				builder.use(configureHttp({ compression: { encodings: ["gzip"] } })),
			);
			const onlyGzip = await wire(gzipOnly.baseUrl, "/api/big", {
				"accept-encoding": "br, gzip",
			});
			expect(onlyGzip.headers["content-encoding"]).toBe("gzip");

			await using withDeflate = await boot((builder) =>
				builder.use(configureHttp({ compression: { encodings: ["deflate", "gzip"] } })),
			);
			const deflate = await wire(withDeflate.baseUrl, "/api/big", {
				"accept-encoding": "gzip, deflate",
			});
			expect(deflate.headers["content-encoding"]).toBe("deflate");
			expect(JSON.parse(deflate.body)).toEqual(bigRows);
		});

		it("adds content types with types (a RegExp)", async () => {
			await using api = await boot((builder) =>
				builder.use(configureHttp({ compression: { types: /^image\/png/ } })),
			);

			const image = await wire(api.baseUrl, "/api/image", { "accept-encoding": "gzip" });

			expect(image.headers["content-encoding"]).toBe("gzip");
		});

		it("accepts a function for types", async () => {
			await using api = await boot((builder) =>
				builder.use(
					configureHttp({ compression: { types: (type) => type.startsWith("image/png") } }),
				),
			);

			const image = await wire(api.baseUrl, "/api/image", { "accept-encoding": "gzip" });

			expect(image.headers["content-encoding"]).toBe("gzip");
		});

		it("compresses application/octet-stream by default (the plugin's default)", async () => {
			await using api = await boot();

			const response = await wire(api.baseUrl, "/api/binary", { "accept-encoding": "gzip" });

			expect(response.headers["content-encoding"]).toBe("gzip");
		});

		it("passes providerOptions to the plugin, overriding the defaults", async () => {
			await using api = await boot((builder) =>
				builder.use(
					configureHttp({ compression: { providerOptions: { threshold: 1_000_000 } } }),
				),
			);

			const response = await wire(api.baseUrl, "/api/big", { "accept-encoding": "gzip" });

			expect(response.headers["content-encoding"]).toBeUndefined();
		});

		it("lets providerOptions reach other plugin options (onUnsupportedEncoding)", async () => {
			await using api = await boot((builder) =>
				builder.use(
					configureHttp({
						compression: {
							providerOptions: {
								onUnsupportedEncoding: () => JSON.stringify({ message: "unsupported" }),
							},
						},
					}),
				),
			);

			const response = await wire(api.baseUrl, "/api/big", { "accept-encoding": "compress" });

			expect(JSON.parse(response.body)).toEqual({ message: "unsupported" });
		});
	});

	describe("files served by statics", () => {
		let site: string;
		const script = `${"export const answer = 42; // padding to pass the threshold\n".repeat(60)}`;

		beforeAll(async () => {
			site = await mkdtemp(path.join(tmpdir(), "http-compress-"));
			await mkdir(path.join(site, "assets"), { recursive: true });
			await writeFile(
				path.join(site, "index.html"),
				`<!doctype html><title>app</title>${bigText}`,
			);
			await writeFile(path.join(site, "assets/index-DiwrgTda.js"), script);
			await writeFile(path.join(site, "assets/pic.png"), bigText);
			await writeFile(path.join(site, "assets/tiny.css"), "body{}");
		});

		afterAll(async () => {
			await rm(site, { recursive: true, force: true });
		});

		const bootUi = () =>
			boot((builder) =>
				builder.use(configureHttp({ statics: [{ prefix: "/ui/", directory: site }] })),
			);

		it("compresses a file on the fly and keeps its caching headers", async () => {
			await using api = await bootUi();

			const asset = await wire(api.baseUrl, "/ui/assets/index-DiwrgTda.js", {
				"accept-encoding": "br, gzip",
			});
			expect(asset.status).toBe(200);
			expect(asset.headers["content-encoding"]).toBe("br");
			expect(asset.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
			expect(asset.headers.etag).toBeDefined();
			expect(asset.headers.vary).toMatch(/accept-encoding/i);
			expect(asset.body).toBe(script);

			const index = await wire(api.baseUrl, "/ui/", { "accept-encoding": "gzip" });
			expect(index.headers["content-encoding"]).toBe("gzip");
			expect(index.headers["cache-control"]).toBe("no-cache");
			expect(index.body).toContain("<title>app</title>");
		});

		it("compresses the SPA fallback like index.html", async () => {
			await using api = await bootUi();

			const response = await wire(api.baseUrl, "/ui/portfolio/42", {
				"accept-encoding": "gzip",
				accept: "text/html",
			});

			expect(response.status).toBe(200);
			expect(response.headers["content-encoding"]).toBe("gzip");
			expect(response.headers["cache-control"]).toBe("no-cache");
		});

		it("answers a conditional request with a 304 and no body", async () => {
			await using api = await bootUi();
			const first = await wire(api.baseUrl, "/ui/assets/index-DiwrgTda.js", {
				"accept-encoding": "gzip",
			});
			const etag = String(first.headers.etag);

			const second = await wire(api.baseUrl, "/ui/assets/index-DiwrgTda.js", {
				"accept-encoding": "gzip",
				"if-none-match": etag,
			});

			expect(second.status).toBe(304);
			expect(second.raw.length).toBe(0);
			expect(second.headers.etag).toBe(first.headers.etag);
			expect(second.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
		});

		it("answers HEAD for a file with no body", async () => {
			await using api = await bootUi();

			const response = await wire(
				api.baseUrl,
				"/ui/assets/index-DiwrgTda.js",
				{ "accept-encoding": "gzip" },
				"HEAD",
			);

			expect(response.status).toBe(200);
			expect(response.raw.length).toBe(0);
			expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
		});

		it("compresses a small text file (the plugin skips its threshold for streams) and leaves a binary file alone", async () => {
			await using api = await bootUi();

			const tiny = await wire(api.baseUrl, "/ui/assets/tiny.css", {
				"accept-encoding": "gzip",
			});
			const png = await wire(api.baseUrl, "/ui/assets/pic.png", { "accept-encoding": "gzip" });

			expect(tiny.headers["content-encoding"]).toBe("gzip");
			expect(tiny.body).toBe("body{}");
			expect(png.headers["content-encoding"]).toBeUndefined();
		});

		it("sends files as they are with compression: false", async () => {
			await using api = await boot((builder) =>
				builder.use(
					configureHttp({
						statics: [{ prefix: "/ui/", directory: site }],
						compression: false,
					}),
				),
			);

			const response = await wire(api.baseUrl, "/ui/assets/index-DiwrgTda.js", {
				"accept-encoding": "gzip",
			});

			expect(response.headers["content-encoding"]).toBeUndefined();
			expect(response.body).toBe(script);
		});
	});
});
