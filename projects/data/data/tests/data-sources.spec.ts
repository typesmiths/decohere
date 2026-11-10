import { ServiceContainerBuilder } from "@decohere/crucible";
import {
	type ConnectionInfo,
	DataConfigurationError,
	dataSources,
	type MigrationTarget,
	type Migrator,
} from "@decohere/data";
import { describe, expect, it, vi } from "vitest";

const source = (overrides: Partial<ConnectionInfo> = {}): ConnectionInfo => ({
	name: "api",
	provider: "postgres",
	host: "127.0.0.1",
	port: 5432,
	database: "api",
	username: "api_app",
	password: "secret",
	synchronize: false,
	seed: false,
	...overrides,
});

describe("dataSources.prepare", () => {
	it("refuses a data source that asks to be set up when the provider was given no bootstrap", async () => {
		await expect(
			dataSources.prepare(
				[source({ bootstrap: true, adminUser: "postgres", adminPassword: "pw" })],
				{
					applicationName: "api",
				},
			),
		).rejects.toThrow(
			new DataConfigurationError(
				'Data source "api" asks to be set up at startup (bootstrap), but the provider was given no bootstrap. Install the package for its database and pass it to the provider: database: postgres, from @decohere/data-postgres. Or set bootstrap: false.',
			),
		);
	});

	it("counts an admin user in development as asking", async () => {
		await expect(
			dataSources.prepare(
				[source({ adminUser: "postgres", auth: "trust", password: undefined })],
				{
					applicationName: "api",
					nodeEnv: "development",
				},
			),
		).rejects.toThrow(/asks to be set up/);
	});

	it("runs the bootstrap it was given, with every data source", async () => {
		const bootstrap = vi.fn().mockResolvedValue(undefined);
		const sources = [source({ bootstrap: true, adminUser: "postgres", adminPassword: "pw" })];

		await dataSources.prepare(sources, {
			applicationName: "api",
			bootstrap,
			nodeEnv: "production",
		});

		expect(bootstrap).toHaveBeenCalledWith(sources, {
			applicationName: "api",
			nodeEnv: "production",
		});
	});

	it("needs no bootstrap when nothing asks for one", async () => {
		await expect(
			dataSources.prepare([source()], { applicationName: "api", nodeEnv: "production" }),
		).resolves.toBeUndefined();
	});

	it("still refuses synchronize outside development, with or without a bootstrap", async () => {
		await expect(
			dataSources.prepare([source({ synchronize: true })], {
				applicationName: "api",
				nodeEnv: "production",
			}),
		).rejects.toThrow(/sets synchronize/);
	});

	it("refuses migrateOnStart outside development: a release step migrates there", async () => {
		await expect(
			dataSources.prepare([source({ migrateOnStart: true })], {
				applicationName: "api",
				nodeEnv: "production",
			}),
		).rejects.toThrow(
			'Data source "api" sets migrateOnStart, which is allowed only in development (NODE_ENV is "production"). Run db migrate as a release step instead.',
		);
	});

	it("refuses migrateOnStart with synchronize", async () => {
		await expect(
			dataSources.prepare([source({ migrateOnStart: true, synchronize: true })], {
				applicationName: "api",
				nodeEnv: "development",
			}),
		).rejects.toThrow(/sets both migrateOnStart and synchronize/);
	});
});

describe("dataSources.start", () => {
	const container = new ServiceContainerBuilder().build();

	function starting(overrides: Partial<ConnectionInfo>, migrator?: Migrator) {
		const steps: string[] = [];
		const connection = source(overrides);
		const target: MigrationTarget | undefined = migrator && {
			dataSource: "api",
			source: { connection, migrations: [], applicationName: "api" },
			migrator,
			diff: async () => ({ up: [], down: [] }),
		};
		return {
			steps,
			source: {
				connection,
				migrations: target,
				synchronize: async () => {
					steps.push("synchronize");
				},
				seed: async () => {
					steps.push("seed");
				},
			},
		};
	}

	it("migrates, then seeds, when migrateOnStart and seed are on", async () => {
		const migrator: Migrator = {
			migrate: vi.fn(async () => {
				steps.push("migrate");
				return [];
			}),
			baseline: vi.fn(),
			revert: vi.fn(),
			status: vi.fn(),
		};
		const { steps, source: s } = starting({ migrateOnStart: true, seed: true }, migrator);

		await dataSources.start(s, container);

		expect(steps).toEqual(["migrate", "seed"]);
		expect(migrator.migrate).toHaveBeenCalledWith(s.migrations?.source, {
			container,
			log: undefined,
		});
	});

	it("synchronizes, then seeds, when synchronize and seed are on", async () => {
		const { steps, source: s } = starting({ synchronize: true, seed: true });

		await dataSources.start(s, container);

		expect(steps).toEqual(["synchronize", "seed"]);
	});

	it("says what to pass when migrateOnStart is on and the provider has no migrator", async () => {
		const { source: s } = starting({ migrateOnStart: true });

		await expect(dataSources.start(s, container)).rejects.toThrow(
			'Data source "api" sets migrateOnStart, but the provider has no migrator. Pass it the database\'s package: database: postgres, from @decohere/data-postgres.',
		);
	});
});
