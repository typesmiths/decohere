import { Builder, type HostedService } from "@decohere/core/hosting";
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

	it("fails the start when a step throws, and starts no hosted service", async () => {
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

		await expect(app.start({ port: 0, shutdownSignals: false })).rejects.toThrow(
			"migration failed",
		);
		await app.dispose();

		expect(log).toEqual([]);
	});
});
