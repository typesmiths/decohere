import { typeOrm } from "../src/typeorm.plugin.js";
import { ServiceContainerBuilder } from "@decohere/crucible";
import "reflect-metadata";
import { type ConnectionInfo, DatabaseConfig } from "@decohere/data";
import { Builder, type HostedService } from "@decohere/core/hosting";
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

		await app.dispose();

		expect(destroy).toHaveBeenCalledTimes(1);
	});
});
