import { typeOrm } from "../src/typeorm.plugin.js";
import { ServiceContainerBuilder } from "@decohere/crucible";
import "reflect-metadata";
import { type ConnectionInfo, DatabaseConfig, DEFAULT_DATA_SOURCE } from "@decohere/data";
import {
	Builder,
	DependencyUnavailableError,
	type HostedService,
	type HostedServiceHost,
	HostedServiceHostToken,
} from "@decohere/core/hosting";
import { injectable } from "@decohere/crucible/decorators";
import {
	ConfigurationServiceToken,
	type IConfigurationService,
} from "@decohere/core/configuration";
import type { Constructable } from "@decohere/core/reflection";
import { DataSource } from "typeorm";
import { afterEach, describe, expect, it, vi } from "vitest";

const connection: ConnectionInfo = {
	name: "default",
	provider: "postgres",
	host: "localhost",
	port: 5432,
	database: "app",
	synchronize: false,
	seed: false,
	username: "app",
	password: "secret",
	bootstrap: false,
};

class StaticConfig implements IConfigurationService {
	public readonly dataSources = [];
	public async get<T extends object>(type: Constructable<T> | string): Promise<T> {
		if (type === DatabaseConfig) {
			const config = new DatabaseConfig();
			config.dataSources = [connection];
			return config as unknown as T;
		}
		return {} as T;
	}
}

let events: string[] = [];

@injectable()
class UsesTheDatabase implements HostedService {
	public start() {}
	public stop() {
		events.push("hosted service stopped");
	}
}

/** The real DataSource class, with connecting and disconnecting stubbed: no database needed. */
function stubConnections() {
	vi.spyOn(DataSource.prototype, "initialize").mockImplementation(async function (
		this: DataSource,
	) {
		Object.assign(this, { isInitialized: true });
		return this;
	});
	return vi.spyOn(DataSource.prototype, "destroy").mockImplementation(async function (
		this: DataSource,
	) {
		events.push("data source destroyed");
		Object.assign(this, { isInitialized: false });
	});
}

describe("typeOrm() lifecycle", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		events = [];
	});

	it("destroys the DataSource when the app stops, after hosted services have stopped", async () => {
		const destroy = stubConnections();
		const app = await Builder.create(new ServiceContainerBuilder())
			.withServices((c) => c.registerSingleton(ConfigurationServiceToken, new StaticConfig()))
			.use(typeOrm({ entities: [] }))
			.withHostedService(UsesTheDatabase)
			.build();
		await app.start({ port: 0, shutdownSignals: false });

		await app.dispose();

		expect(destroy).toHaveBeenCalledTimes(1);
		expect(events).toEqual(["hosted service stopped", "data source destroyed"]);
	});

	it("destroys a DataSource nothing resolved (no request ever used it)", async () => {
		const destroy = stubConnections();
		const app = await Builder.create(new ServiceContainerBuilder())
			.withServices((c) => c.registerSingleton(ConfigurationServiceToken, new StaticConfig()))
			.use(typeOrm({ entities: [] }))
			.build();
		await app.start({ port: 0, shutdownSignals: false });

		await app.dispose();

		expect(destroy).toHaveBeenCalledTimes(1);
	});
});

describe("typeOrm() with the database down", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		events = [];
	});

	/** initialize() fails until `up()` is called, like a database still coming up. */
	function databaseDown() {
		let reachable = false;
		const initialize = vi
			.spyOn(DataSource.prototype, "initialize")
			.mockImplementation(async function (this: DataSource) {
				if (!reachable) throw new Error("connect ECONNREFUSED 127.0.0.1:5432");
				Object.assign(this, { isInitialized: true });
				return this;
			});
		vi.spyOn(DataSource.prototype, "destroy").mockImplementation(async function (
			this: DataSource,
		) {
			Object.assign(this, { isInitialized: false });
		});
		return {
			initialize,
			up: () => {
				reachable = true;
			},
		};
	}

	function build() {
		return Builder.create(new ServiceContainerBuilder())
			.withServices((c) => c.registerSingleton(ConfigurationServiceToken, new StaticConfig()))
			.use(typeOrm({ entities: [] }))
			.withHostedService(UsesTheDatabase)
			.build();
	}

	it("builds without connecting", async () => {
		const { initialize } = databaseDown();

		const app = await build();

		expect(initialize).not.toHaveBeenCalled();
		await app.dispose();
	});

	it("starts anyway, not ready and answering requests as unavailable, until the database comes up", async () => {
		const database = databaseDown();
		const app = await build();

		await app.start({ port: 0, shutdownSignals: false, startRetry: { initialMs: 10 } });
		const host = app.services.resolve<HostedServiceHost>(HostedServiceHostToken);

		expect(host.readinessChecks().map((c) => c.name)).toEqual(["typeorm data sources"]);
		{
			await using scope = app.services.beginScope("a request");
			expect(() => scope.resolve(DEFAULT_DATA_SOURCE)).toThrow(DependencyUnavailableError);
		}

		database.up();
		const deadline = Date.now() + 2_000;
		while (host.readinessChecks().length > 0 && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 5));
		}

		expect(host.readinessChecks()).toEqual([]);
		{
			await using scope = app.services.beginScope("a later request");
			expect(scope.resolve(DEFAULT_DATA_SOURCE)).toBeDefined();
		}
		await app.dispose();
	});

	it("with startRetry: false, fails the start with the connection error", async () => {
		databaseDown();
		const app = await build();

		await expect(
			app.start({ port: 0, shutdownSignals: false, startRetry: false }),
		).rejects.toThrow("ECONNREFUSED");
		await app.dispose();
	});
});
