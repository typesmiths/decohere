import { Builder, type HostedService } from "@decohere/core/hosting";
import { ServiceContainerBuilder } from "@decohere/crucible";
import { inject } from "@decohere/crucible/decorators";
import { describe, expect, it, vi } from "vitest";

const log: string[] = [];

class Clock {
	public now() {
		return "tick";
	}
}

class QueueConsumer implements HostedService {
	public constructor(@inject(Clock) private readonly clock: Clock) {}

	public start(signal: AbortSignal) {
		log.push(`start ${this.clock.now()} aborted=${signal.aborted}`);
	}

	public stop() {
		log.push("stop");
	}
}

describe("a worker with no HTTP", () => {
	it("starts its hosted services and stops them when disposed", async () => {
		const app = await Builder.create(new ServiceContainerBuilder())
			.withServices((container) => container.registerSingleton(Clock))
			.withHostedService(QueueConsumer)
			.build();

		await app.start({ port: 0, shutdownSignals: false });
		await app.dispose();

		expect(log).toEqual(["start tick aborted=false", "stop"]);
		expect(app.addresses).toEqual([]);
	});

	it.each([
		"core/package.json",
		"crucible/package.json",
		"scribe/scribe/package.json",
		"config/package.json",
		"data/data/package.json",
		"data/data-typeorm/package.json",
	])("installing %s doesn't bring in @decohere/http", async (manifest) => {
		// The unit tests' fs is in memory; the manifests are on the real one.
		const { readFileSync } = await vi.importActual<typeof import("node:fs")>("node:fs");
		const url = new URL(`../../../${manifest}`, import.meta.url);
		const { dependencies } = JSON.parse(readFileSync(url, "utf8")) as {
			dependencies?: Record<string, string>;
		};
		expect(Object.keys(dependencies ?? {})).not.toContain("@decohere/http");
	});
});
