import { http } from "../src/http/http.plugin.js";
import { health } from "../src/health/health.plugin.js";
import { ServiceContainerBuilder } from "@decohere/crucible";
import { inject, injectable } from "@decohere/crucible/decorators";
import { afterEach, describe, expect, it } from "vitest";
import { type App, Builder } from "@decohere/core/hosting";
import type { HostedService } from "@decohere/core/hosting";
import { FastifyProvider } from "../src/providers/fastify.provider.js";

/** What happened, in order, across every service and the app in one test. */
let events: string[] = [];

const DbToken = Symbol("Db");

/** Stands in for a connection pool: closed when the app's container is disposed. */
@injectable()
class Db {
	public async [Symbol.asyncDispose]() {
		events.push("db closed");
	}
}

/** Records its lifecycle. Subclassed, not built by a factory: the container keys a class by name. */
abstract class Recording implements HostedService {
	protected abstract readonly label: string;
	public constructor(private readonly db: Db) {}
	public start(signal: AbortSignal) {
		signal.addEventListener("abort", () => events.push(`${this.label} signal aborted`));
		events.push(`${this.label} started (db ${this.db == null ? "missing" : "ready"})`);
	}
	public stop() {
		events.push(`${this.label} stopped`);
	}
}

@injectable()
class First extends Recording {
	protected readonly label = "first";
	public constructor(@inject(DbToken) db: Db) {
		super(db);
	}
}

@injectable()
class Second extends Recording {
	protected readonly label = "second";
	public constructor(@inject(DbToken) db: Db) {
		super(db);
	}
}

/** A worker that ticks on a timer until its signal is aborted, like a feed refresh loop. */
@injectable()
class Ticker implements HostedService {
	public ticks = 0;
	public start(signal: AbortSignal) {
		const timer = setInterval(() => {
			this.ticks += 1;
		}, 5);
		signal.addEventListener("abort", () => clearInterval(timer));
	}
}

function builder() {
	return Builder.create(new ServiceContainerBuilder()).withServices((c) =>
		c.registerSingleton(DbToken, Db),
	);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("hosted services", () => {
	let app: App | undefined;

	afterEach(async () => {
		await app?.dispose();
		app = undefined;
		events = [];
	});

	it("starts each service once, in registration order, before the app listens", async () => {
		@injectable()
		class SeesAddresses implements HostedService {
			public constructor(@inject(DbToken) private readonly db: Db) {}
			public start() {
				events.push(`listening during start: ${String(appRef?.addresses.length ?? 0)}`);
				void this.db;
			}
		}
		let appRef: App | undefined;
		app = await builder()
			.use(http(FastifyProvider))
			.withHostedService(First, Second, SeesAddresses)
			.build();
		appRef = app;

		await app.start({ port: 0, host: "127.0.0.1", shutdownSignals: false });

		expect(events).toEqual([
			"first started (db ready)",
			"second started (db ready)",
			"listening during start: 0",
		]);
		expect(app.addresses).toHaveLength(1);
	});

	it("stops in reverse order: signal first, then each stop(), then the container", async () => {
		app = await builder().use(http(FastifyProvider)).withHostedService(First, Second).build();
		await app.start({ port: 0, host: "127.0.0.1", shutdownSignals: false });
		events = [];

		await app.dispose();

		expect(events).toEqual([
			"first signal aborted",
			"second signal aborted",
			"second stopped",
			"first stopped",
			"db closed",
		]);
	});

	it("runs in an app with no HTTP server", async () => {
		app = await builder().withHostedService(First).build();

		await app.start({ port: 0, shutdownSignals: false });
		await app.dispose();

		expect(events).toEqual([
			"first started (db ready)",
			"first signal aborted",
			"first stopped",
			"db closed",
		]);
	});

	// Flux reboots an app by calling its default export's Symbol.asyncDispose.
	it("leaves no timer running after a Flux reboot (Symbol.asyncDispose)", async () => {
		app = await builder().withHostedService(Ticker).build();
		await app.start({ port: 0, shutdownSignals: false });
		await sleep(30);
		const ticker = (
			app as unknown as { container: { resolve(t: unknown): Ticker } }
		).container.resolve(Ticker);
		expect(ticker.ticks).toBeGreaterThan(0);

		await app[Symbol.asyncDispose]();
		const ticksAtStop = ticker.ticks;
		await sleep(30);

		expect(ticker.ticks).toBe(ticksAtStop);
	});

	it("is the same instance when injected by its class", async () => {
		@injectable()
		class ReadsTicker {
			public constructor(@inject(Ticker) public readonly ticker: Ticker) {}
		}
		app = await builder()
			.withHostedService(Ticker)
			.withServices((c) => c.registerSingleton(ReadsTicker))
			.build();
		await app.start({ port: 0, shutdownSignals: false });
		await sleep(20);

		const container = (app as unknown as { container: { resolve<T>(t: unknown): T } })
			.container;
		const reader = container.resolve<ReadsTicker>(ReadsTicker);

		expect(reader.ticker.ticks).toBeGreaterThan(0);
	});

	it("does not wait for background work started by start()", async () => {
		@injectable()
		class SlowWarmUp implements HostedService {
			public warm = false;
			public start(signal: AbortSignal) {
				// The ledger position feed: minutes of loading, started in the background.
				void sleep(10_000).then(() => {
					if (!signal.aborted) this.warm = true;
				});
			}
		}
		app = await builder().use(http(FastifyProvider)).withHostedService(SlowWarmUp).build();

		const started = Date.now();
		await app.start({ port: 0, host: "127.0.0.1", shutdownSignals: false });

		expect(Date.now() - started).toBeLessThan(2_000);
		expect(app.addresses).toHaveLength(1);
	});

	it("aborts the signal of a start() still running when the app stops, then stops it", async () => {
		let release: () => void = () => {};
		@injectable()
		class Starting implements HostedService {
			public async start(signal: AbortSignal) {
				events.push("start begun");
				signal.addEventListener("abort", () => events.push("signal aborted"));
				await new Promise<void>((resolve) => {
					release = resolve;
				});
				events.push("start finished");
			}
			public stop() {
				events.push("stopped");
			}
		}
		app = await builder().withHostedService(Starting).build();

		const starting = app.start({ port: 0, shutdownSignals: false });
		await sleep(5);
		const stopping = app.dispose();
		await sleep(5);
		release();
		await Promise.allSettled([starting, stopping]);

		expect(events).toEqual(["start begun", "signal aborted", "start finished", "stopped"]);
	});

	it("stops the services already started when a later start() fails, and fails app.start", async () => {
		@injectable()
		class Broken implements HostedService {
			public start() {
				events.push("broken started");
				throw new Error("feed unreachable");
			}
			public stop() {
				events.push("broken stopped");
			}
		}
		app = await builder()
			.use(http(FastifyProvider))
			.withHostedService(First, Broken, Second)
			.build();

		await expect(
			app.start({ port: 0, host: "127.0.0.1", shutdownSignals: false }),
		).rejects.toThrow("feed unreachable");

		expect(events).toEqual([
			"first started (db ready)",
			"broken started",
			"first signal aborted",
			"first stopped",
		]);
		expect(app.addresses).toHaveLength(0);
	});

	it("keeps stopping the others when one stop() throws", async () => {
		@injectable()
		class FailsToStop implements HostedService {
			public start() {}
			public stop() {
				throw new Error("stuck");
			}
		}
		app = await builder().withHostedService(First, FailsToStop, Second).build();
		await app.start({ port: 0, shutdownSignals: false });
		events = [];

		await expect(app.dispose()).rejects.toThrow("stuck");
		app = undefined; // dispose() keeps returning that rejection

		expect(events).toContain("second stopped");
		expect(events).toContain("first stopped");
		expect(events.at(-1)).toBe("db closed");
	});

	it("reports a warming service as not ready on /ready until its check() passes", async () => {
		@injectable()
		class Warming implements HostedService {
			public warm = false;
			public start() {}
			public async check() {
				if (!this.warm) throw new Error("still loading positions");
			}
		}
		app = await builder()
			.use(http(FastifyProvider))
			.use(health())
			.withHostedService(Warming)
			.build();
		await app.start({ port: 0, host: "127.0.0.1", shutdownSignals: false });
		const url = `${app.addresses[0]}/ready`;

		expect((await fetch(url)).status).toBe(503);
		const container = (app as unknown as { container: { resolve<T>(t: unknown): T } })
			.container;
		container.resolve<Warming>(Warming).warm = true;
		expect((await fetch(url)).status).toBe(200);
		expect((await fetch(`${app.addresses[0]}/health`)).status).toBe(200);
	});
});
