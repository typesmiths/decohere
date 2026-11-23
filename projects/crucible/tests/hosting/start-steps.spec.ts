import {
	Builder,
	type HostedService,
	type HostedServiceHost,
	HostedServiceHostToken,
} from "@decohere/core/hosting";
import { ServiceContainerBuilder } from "@decohere/crucible";
import { describe, expect, it } from "vitest";

describe("builder.registerStartStep", () => {
	it("runs on start, in order and before hosted services, not when the app is built", async () => {
		const log: string[] = [];
		class Worker implements HostedService {
			public start() {
				log.push("hosted service");
			}
		}
		const builder = Builder.create(new ServiceContainerBuilder()).withHostedService(Worker);
		builder.registerStartStep(() => {
			log.push("first");
		});
		builder.registerStartStep(async (container) => {
			log.push(`second sees ${container.resolve(Worker).constructor.name}`);
		});

		const app = await builder.build();
		expect(log).toEqual([]);

		await app.start({ port: 0, shutdownSignals: false });
		await app.dispose();

		expect(log).toEqual(["first", "second sees Worker", "hosted service"]);
	});

	it("with startRetry: false, fails the start when a step throws, and starts no hosted service", async () => {
		const log: string[] = [];
		class Worker implements HostedService {
			public start() {
				log.push("hosted service");
			}
		}
		const builder = Builder.create(new ServiceContainerBuilder()).withHostedService(Worker);
		builder.registerStartStep(() => {
			throw new Error("migration failed");
		});
		const app = await builder.build();

		await expect(
			app.start({ port: 0, shutdownSignals: false, startRetry: false }),
		).rejects.toThrow("migration failed");
		await app.dispose();

		expect(log).toEqual([]);
	});

	it("retries a step that throws, and starts the hosted services only once it has run", async () => {
		const log: string[] = [];
		class Worker implements HostedService {
			public start() {
				log.push("hosted service");
			}
		}
		let attempts = 0;
		const builder = Builder.create(new ServiceContainerBuilder()).withHostedService(Worker);
		builder.registerStartStep(() => {
			attempts += 1;
			log.push(`migrate attempt ${attempts}`);
			if (attempts < 3) throw new Error("database not reachable");
		}, "migrations");
		const app = await builder.build();

		await app.start({ port: 0, shutdownSignals: false, startRetry: { initialMs: 10 } });
		const host = app.services.resolve<HostedServiceHost>(HostedServiceHostToken);

		expect(log).toEqual(["migrate attempt 1"]);
		expect(host.readinessChecks().map((c) => c.name)).toEqual(["migrations"]);
		expect(await app.hostedServicesStarted()).toEqual([
			{ name: "migrations", ms: expect.any(Number), started: false },
		]);

		const deadline = Date.now() + 2_000;
		while (!log.includes("hosted service") && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		await app.dispose();

		expect(log).toEqual([
			"migrate attempt 1",
			"migrate attempt 2",
			"migrate attempt 3",
			"hosted service",
		]);
	});

	it("stops retrying a step when the app stops, and starts nothing after it", async () => {
		const log: string[] = [];
		class Worker implements HostedService {
			public start() {
				log.push("hosted service");
			}
		}
		const builder = Builder.create(new ServiceContainerBuilder()).withHostedService(Worker);
		builder.registerStartStep(() => {
			log.push("migrate attempt");
			throw new Error("database not reachable");
		});
		const app = await builder.build();
		await app.start({ port: 0, shutdownSignals: false, startRetry: { initialMs: 10 } });
		await new Promise((resolve) => setTimeout(resolve, 40));

		await app.dispose();
		const attempts = log.length;
		await new Promise((resolve) => setTimeout(resolve, 60));

		expect(log.length).toBe(attempts);
		expect(log).not.toContain("hosted service");
	});
});
