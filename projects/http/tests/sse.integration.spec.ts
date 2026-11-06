import { configureHttp } from "../src/http/http.plugin.js";
import { auth } from "../src/auth/auth.plugin.js";
import { setTimeout as sleep } from "node:timers/promises";
import type { ContainerBuilder } from "@decohere/crucible";
import { inject, injectable } from "@decohere/crucible/decorators";
import type { IConfigurationService } from "@decohere/core/configuration";
import { ConfigurationServiceToken } from "@decohere/core/configuration";
import type { Constructable } from "@decohere/core/reflection";
import { describe, expect, it } from "vitest";
import type { OpenApiDocument } from "../src/openapi/openapi.types.js";
import { AuthConfig } from "../src/auth/auth.config.js";
import { TokenService } from "../src/auth/token-service.js";
import {
	AllowAnonymous,
	Authorize,
	Controller,
	Get,
	LastEventId,
	Signal,
	Sse,
	type SseStream,
} from "../src/index.js";
import { bootModule } from "../src/testing/index.js";

/** Records what the producers did, so tests can see that cleanup ran. */
class Probe {
	public started = 0;
	public timersRunning = 0;
	public signalAborted = false;
	public lastEventId: string | undefined;
	public scopeDisposed = false;
}
const probe = new Probe();

/** Request-scoped: lives as long as the stream, disposed when it ends. */
@injectable()
class RequestResource {
	public constructor() {
		probe.scopeDisposed = false;
	}
	public async [Symbol.asyncDispose]() {
		probe.scopeDisposed = true;
	}
}

/** A producer that owns a timer, like a real subscription would. */
async function* ticker(signal: AbortSignal, intervalMs: number): AsyncGenerator<string> {
	probe.started += 1;
	probe.timersRunning += 1;
	let tick = 0;
	try {
		while (!signal.aborted) {
			await new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, intervalMs);
				signal.addEventListener(
					"abort",
					() => {
						clearTimeout(timer);
						resolve();
					},
					{ once: true },
				);
			});
			if (!signal.aborted) yield `tick ${++tick}`;
		}
	} finally {
		probe.timersRunning -= 1;
		probe.signalAborted = signal.aborted;
	}
}

@Controller({ prefix: "/feed" })
class FeedController {
	public constructor(@inject(RequestResource) private readonly resource: RequestResource) {}

	@Sse()
	@Get("/items")
	public async *items(): SseStream {
		probe.started += 1;
		yield { id: "1", event: "item", data: { name: "first" } };
		yield { id: "2", event: "item", data: { name: "second" } };
		yield "plain text";
		yield { data: "line one\nline two" };
	}

	@Sse()
	@Get("/resume")
	public async *resume(@LastEventId() lastEventId?: string): SseStream {
		probe.lastEventId = lastEventId;
		const from = lastEventId == null ? 1 : Number(lastEventId) + 1;
		for (const id of [from, from + 1]) {
			yield { id: String(id), data: `event ${id}` };
		}
	}

	@Sse({ heartbeatMs: 20 })
	@Get("/quiet")
	public async *quiet(@Signal() signal: AbortSignal): SseStream {
		yield "hello";
		await sleep(100, undefined, { signal });
		yield "world";
	}

	@Sse({ heartbeatMs: 0 })
	@Get("/live")
	public async *live(@Signal() signal: AbortSignal): SseStream {
		void this.resource;
		yield { id: "0", data: "connected" };
		for await (const message of ticker(signal, 10)) yield message;
	}

	@Sse()
	@Get("/broken")
	public async *broken(): SseStream {
		yield "before";
		throw new Error("producer exploded");
	}

	@Sse()
	@Get("/not-a-stream")
	public notAStream() {
		return { oops: true };
	}

	@Get("/plain")
	public plain() {
		return { ok: true };
	}
}

describe("server-sent events from a controller route", () => {
	it("writes the handler's events as text/event-stream", async () => {
		await using api = await bootModule({
			controllers: [FeedController],
			services: services(),
		});

		const read = await api.readEvents("/feed/items", { count: 4 });

		expect(read.status).toBe(200);
		expect(read.headers.get("content-type")).toContain("text/event-stream");
		expect(read.headers.get("cache-control")).toContain("no-cache");
		expect(read.events).toEqual([
			{ id: "1", event: "item", data: '{"name":"first"}' },
			{ id: "2", event: "item", data: '{"name":"second"}' },
			{ data: "plain text" },
			{ data: "line one\nline two" },
		]);
	});

	it("ends the response when the handler finishes", async () => {
		await using api = await bootModule({
			controllers: [FeedController],
			services: services(),
		});

		const read = await api.readEvents("/feed/items", { count: Infinity });

		expect(read.ended).toBe(true);
		expect(read.events).toHaveLength(4);
	});

	it("gives the handler the Last-Event-ID the browser sends when it reconnects", async () => {
		await using api = await bootModule({
			controllers: [FeedController],
			services: services(),
		});

		const first = await api.readEvents("/feed/resume", { count: 2 });
		expect(first.events.map((e) => e.id)).toEqual(["1", "2"]);
		expect(probe.lastEventId).toBeUndefined();

		const resumed = await api.readEvents("/feed/resume", {
			count: 2,
			headers: { "Last-Event-ID": "2" },
		});
		expect(probe.lastEventId).toBe("2");
		expect(resumed.events.map((e) => e.id)).toEqual(["3", "4"]);
	});

	it("writes a heartbeat comment while the producer is quiet", async () => {
		await using api = await bootModule({
			controllers: [FeedController],
			services: services(),
		});

		const read = await api.readEvents("/feed/quiet", { count: 2 });

		expect(read.events.map((e) => e.data)).toEqual(["hello", "world"]);
		expect(read.comments.filter((c) => c === "heartbeat").length).toBeGreaterThanOrEqual(2);
	});

	it("ends the stream without sending a half-built event when the producer throws", async () => {
		await using api = await bootModule({
			controllers: [FeedController],
			services: services(),
		});

		const read = await api.readEvents("/feed/broken", { count: Infinity });

		expect(read.events).toEqual([{ data: "before" }]);
		expect(read.ended).toBe(true);
	});

	it("answers 500 for an @Sse() method that does not return a stream", async () => {
		await using api = await bootModule({
			controllers: [FeedController],
			services: services(),
		});

		const read = await api.readEvents("/feed/not-a-stream");

		expect(read.status).toBe(500);
		expect(read.events).toEqual([]);
	});

	it("leaves ordinary routes alone", async () => {
		await using api = await bootModule({
			controllers: [FeedController],
			services: services(),
		});

		const response = await fetch(`${api.baseUrl}/feed/plain`);

		expect(response.headers.get("content-type")).toContain("application/json");
		expect(await response.json()).toEqual({ ok: true });
	});
});

describe("SSE: client disconnect and app stop", () => {
	it("stops the producer, its timer and the request scope when the client disconnects", async () => {
		await using api = await bootModule({
			controllers: [FeedController],
			services: services(),
		});
		const timersBefore = probe.timersRunning;
		probe.signalAborted = false;

		const read = await api.readEvents("/feed/live", { count: 2 });

		expect(read.events.length).toBe(2);
		await waitFor(() => probe.timersRunning === timersBefore);
		expect(probe.signalAborted).toBe(true);
		await waitFor(() => probe.scopeDisposed);
	});

	it("keeps request-scoped services alive while the stream is running", async () => {
		await using api = await bootModule({
			controllers: [FeedController],
			services: services(),
		});

		const reading = api.readEvents("/feed/live", { count: Infinity, timeoutMs: 4000 });
		await sleep(80);

		expect(probe.scopeDisposed).toBe(false);
		await api.stop();
		await reading;
		expect(probe.scopeDisposed).toBe(true);
	});

	it("closes open streams when the app stops, so stopping does not hang", async () => {
		const api = await bootModule({ controllers: [FeedController], services: services() });
		const timersBefore = probe.timersRunning;

		const reading = api.readEvents("/feed/live", { count: Infinity, timeoutMs: 4000 });
		await waitFor(() => probe.timersRunning > timersBefore);

		await api.stop();
		const read = await reading;

		expect(read.ended).toBe(true);
		expect(probe.timersRunning).toBe(timersBefore);
		expect(probe.signalAborted).toBe(true);
	});

	it("closes open streams on the dispose path Flux uses for a reboot", async () => {
		const api = await bootModule({ controllers: [FeedController], services: services() });
		const timersBefore = probe.timersRunning;
		const reading = api.readEvents("/feed/live", { count: Infinity, timeoutMs: 4000 });
		await waitFor(() => probe.timersRunning > timersBefore);

		// Flux calls Symbol.asyncDispose on the entry's default export, which is the app.
		await api.app[Symbol.asyncDispose]();

		expect((await reading).ended).toBe(true);
		expect(probe.timersRunning).toBe(timersBefore);
	});
});

// Auth: a real shared-secret token service, no dev shortcuts.
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

@Controller({ prefix: "/secure" })
class SecureFeedController {
	@Authorize("read", "Article")
	@Sse()
	@Get("/articles")
	public async *articles(): SseStream {
		probe.started += 1;
		yield { id: "1", data: "secret article" };
	}

	@AllowAnonymous()
	@Sse()
	@Get("/public")
	public async *open(): SseStream {
		yield "hello everyone";
	}
}

describe("SSE: auth runs before any event is sent", () => {
	const boot = () =>
		bootModule({
			controllers: [SecureFeedController],
			services: (c) =>
				c.registerSingleton(ConfigurationServiceToken, new SecretConfigService()),
			configure: (builder) => builder.use(auth()),
		});
	const tokens = new TokenService(secretConfig);

	it("answers 401 with no events when there is no token", async () => {
		await using api = await boot();
		probe.started = 0;

		const read = await api.readEvents("/secure/articles");

		expect(read.status).toBe(401);
		expect(read.events).toEqual([]);
		expect(read.headers.get("content-type")).not.toContain("text/event-stream");
		expect(probe.started).toBe(0);
	});

	it("answers 403 with no events when the token lacks the permission", async () => {
		await using api = await boot();
		probe.started = 0;
		const token = await tokens.sign({ sub: "alice", scope: "read:Comment" });

		const read = await api.readEvents("/secure/articles", {
			headers: { authorization: `Bearer ${token}` },
		});

		expect(read.status).toBe(403);
		expect(read.events).toEqual([]);
		expect(probe.started).toBe(0);
	});

	it("streams to a caller whose token allows it", async () => {
		await using api = await boot();
		const token = await tokens.sign({ sub: "alice", scope: "read:Article" });

		const read = await api.readEvents("/secure/articles", {
			headers: { authorization: `Bearer ${token}` },
		});

		expect(read.status).toBe(200);
		expect(read.events).toEqual([{ id: "1", data: "secret article" }]);
	});

	it("honours @AllowAnonymous on a stream", async () => {
		await using api = await boot();

		const read = await api.readEvents("/secure/public");

		expect(read.events).toEqual([{ data: "hello everyone" }]);
	});
});

describe("SSE: OpenAPI", () => {
	it("documents a stream route as text/event-stream, with the Last-Event-ID header", async () => {
		await using api = await bootModule({
			controllers: [FeedController],
			services: services(),
			configure: (builder) =>
				builder.use(configureHttp({ openApi: { info: { title: "t", version: "1" } } })),
		});

		const document = (await (
			await fetch(`${api.baseUrl}/openapi.json`)
		).json()) as OpenApiDocument;

		const stream = document.paths["/feed/items"].get;
		expect(stream.responses["200"].content).toEqual({
			"text/event-stream": { schema: { type: "string" } },
		});
		const resume = document.paths["/feed/resume"].get;
		expect(resume.parameters).toContainEqual({
			name: "Last-Event-ID",
			in: "header",
			schema: { type: "string" },
		});
		expect(document.paths["/feed/plain"].get.responses["200"].content).toBeUndefined();
	});
});

function services() {
	return (c: ContainerBuilder) => {
		c.registerRequestScoped(RequestResource);
	};
}

async function waitFor(condition: () => boolean, timeoutMs = 2000) {
	const deadline = Date.now() + timeoutMs;
	while (!condition()) {
		if (Date.now() > deadline) throw new Error("condition not met in time");
		await sleep(5);
	}
}
