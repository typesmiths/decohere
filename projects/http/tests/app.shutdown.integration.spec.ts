import { http } from "../src/http/http.plugin.js";
import { ServiceContainerBuilder } from "@decohere/crucible";
import { createConnection } from "node:net";
import { inject, injectable } from "@decohere/crucible/decorators";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type App, Builder } from "@decohere/core/hosting";
import { FastifyProvider } from "../src/providers/fastify.provider.js";
import { Controller, Get } from "../src/routing/index.js";

const DbToken = Symbol("Db");

/** Stands in for a connection pool: closed when the app's container is disposed. */
@injectable()
class Db {
	public closed = false;
	public async [Symbol.asyncDispose]() {
		this.closed = true;
	}
}

/**
 * The test decides when a request is in flight: `arrived` resolves once the handler has it, and
 * the handler answers when the test calls `release`. A fixed sleep before SIGTERM let a loaded
 * machine start shutting down before the request arrived, and it got a 503.
 */
let slow = gate();

function gate() {
	let release = () => {};
	let arrive = () => {};
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	const arrived = new Promise<void>((resolve) => {
		arrive = resolve;
	});
	return { arrive, arrived, release, released };
}

@Controller({ prefix: "/slow" })
class SlowController {
	public constructor(@inject(DbToken) private readonly db: Db) {}

	@Get("/wait")
	public async slow() {
		slow.arrive();
		await slow.released;
		return { dbClosedDuringRequest: this.db.closed };
	}
}

/** Open (and close) a raw TCP connection — no HTTP agent that might reuse a kept-alive socket. */
function connect(baseURL: string): Promise<void> {
	const { hostname, port } = new URL(baseURL);
	return new Promise((resolve, reject) => {
		const socket = createConnection({ host: hostname, port: Number(port) });
		socket.once("connect", () => {
			socket.destroy();
			resolve();
		});
		socket.once("error", reject);
	});
}

async function buildApp(): Promise<App> {
	return Builder.create(new ServiceContainerBuilder())
		.use(http(FastifyProvider, { controllers: [SlowController] }))
		.withServices((c) => c.registerSingleton(DbToken, Db))
		.build();
}

/** The listener `app.start()` added for `signal` (invoked directly; emitting would hit the test runner too). */
async function startCapturing(app: App, signal: NodeJS.Signals, options = {}) {
	const before = new Set(process.listeners(signal));
	await app.start({ port: 0, host: "127.0.0.1", ...options });
	const added = process.listeners(signal).filter((listener) => !before.has(listener));
	return {
		baseURL: app.addresses[0] as string,
		handler: added[0] as (s: NodeJS.Signals) => void,
		added,
	};
}

describe("graceful shutdown on SIGTERM / SIGINT", () => {
	let app: App | undefined;
	/** Cancels requests that never answer, so the server can close in afterEach. */
	let hung: AbortController;

	beforeEach(() => {
		hung = new AbortController();
		slow = gate();
	});

	afterEach(async () => {
		hung.abort();
		await app?.dispose();
		app = undefined;
		vi.restoreAllMocks();
	});

	it("lets an in-flight request finish before closing dependencies, then stops listening", async () => {
		app = await buildApp();
		const { baseURL, handler } = await startCapturing(app, "SIGTERM");

		const inFlight = axios.get(`${baseURL}/slow/wait`);
		await slow.arrived;
		handler("SIGTERM");
		// Shutdown is under way while the request is still in the handler: the port refuses
		// new connections before the request is allowed to answer.
		await vi.waitFor(() =>
			expect(connect(baseURL)).rejects.toMatchObject({ code: "ECONNREFUSED" }),
		);
		slow.release();

		const res = await inFlight;
		expect(res.status).toBe(200);
		expect(res.data).toEqual({ dbClosedDuringRequest: false });

		await app.dispose(); // same shutdown already under way
		await expect(connect(baseURL)).rejects.toMatchObject({ code: "ECONNREFUSED" });
	});

	it("handles SIGINT too, and removes both listeners once stopped", async () => {
		app = await buildApp();
		const intBefore = process.listeners("SIGINT").length;
		const term = await startCapturing(app, "SIGTERM");
		expect(term.added).toHaveLength(1);
		expect(process.listeners("SIGINT")).toHaveLength(intBefore + 1);

		await app.dispose();
		expect(process.listeners("SIGTERM")).not.toContain(term.handler);
		expect(process.listeners("SIGINT")).toHaveLength(intBefore);
	});

	it("registers nothing when shutdownSignals is false", async () => {
		app = await buildApp();
		const { added } = await startCapturing(app, "SIGTERM", { shutdownSignals: false });
		expect(added).toHaveLength(0);
	});

	it("exits with code 1 when stopping takes longer than shutdownTimeoutMs", async () => {
		// Signalled once the request is in the handler: a fixed sleep before SIGTERM let a slow
		// machine stop before the request arrived, so nothing was in flight and it exited 0.
		let arrived = () => {};
		const inHandler = new Promise<void>((resolve) => {
			arrived = resolve;
		});
		@Controller({ prefix: "/hang" })
		class HangController {
			@Get("/wait")
			public hang() {
				arrived();
				return new Promise(() => {});
			}
		}
		app = await Builder.create(new ServiceContainerBuilder())
			.use(http(FastifyProvider, { controllers: [HangController] }))
			.build();
		const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
		const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
		const { baseURL, handler } = await startCapturing(app, "SIGTERM", {
			shutdownTimeoutMs: 50,
		});

		axios.get(`${baseURL}/hang/wait`, { signal: hung.signal }).catch(() => {});
		await inHandler;
		handler("SIGTERM");

		await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1), { timeout: 1000 });
		expect(stderr.mock.calls.flat().join(" ")).toContain("50ms");
	});

	it("stops listening for signals as soon as shutdown starts, so a second one exits the default way", async () => {
		app = await buildApp();
		const { handler } = await startCapturing(app, "SIGTERM");
		const intBefore = process.listeners("SIGINT").length;

		handler("SIGTERM");

		expect(process.listeners("SIGTERM")).not.toContain(handler);
		expect(process.listeners("SIGINT")).toHaveLength(intBefore - 1);
		await app.dispose();
	});
});
