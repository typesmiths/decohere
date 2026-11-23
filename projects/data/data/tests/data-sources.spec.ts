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

describe("dataSources.check", () => {
	it("refuses a data source that asks to be set up when the provider was given no bootstrap", () => {
		expect(() =>
			dataSources.check(
				[source({ bootstrap: true, adminUser: "postgres", adminPassword: "pw" })],
				{},
			),
		).toThrow(
			new DataConfigurationError(
				'Data source "api" asks to be set up at startup (bootstrap), but the provider was given no bootstrap. Install the package for its database and pass it to the provider: database: postgres, from @decohere/data-postgres. Or set bootstrap: false.',
			),
		);
	});

	it("counts an admin user in development as asking", () => {
		expect(() =>
			dataSources.check(
				[source({ adminUser: "postgres", auth: "trust", password: undefined })],
				{
					nodeEnv: "development",
				},
			),
		).toThrow(/asks to be set up/);
	});

	it("passes when the provider was given a bootstrap", () => {
		expect(() =>
			dataSources.check(
				[source({ bootstrap: true, adminUser: "postgres", adminPassword: "pw" })],
				{ bootstrap: vi.fn(), nodeEnv: "production" },
			),
		).not.toThrow();
	});

	it("needs no bootstrap when nothing asks for one", () => {
		expect(() => dataSources.check([source()], { nodeEnv: "production" })).not.toThrow();
	});

	it("still refuses synchronize outside development, with or without a bootstrap", () => {
		expect(() =>
			dataSources.check([source({ synchronize: true })], {
				nodeEnv: "production",
			}),
		).toThrow(/sets synchronize/);
	});

	it("refuses migrateOnStart outside development: a release step migrates there", () => {
		expect(() =>
			dataSources.check([source({ migrateOnStart: true })], {
				nodeEnv: "production",
			}),
		).toThrow(
			'Data source "api" sets migrateOnStart, which is allowed only in development (NODE_ENV is "production"). Run db migrate as a release step instead.',
		);
	});

	it("refuses migrateOnStart with synchronize", () => {
		expect(() =>
			dataSources.check([source({ migrateOnStart: true, synchronize: true })], {
				nodeEnv: "development",
			}),
		).toThrow(/sets both migrateOnStart and synchronize/);
	});
});

describe("dataSources.open", () => {
	it("runs the bootstrap once with every data source, then connects each", async () => {
		const steps: string[] = [];
		const bootstrap = vi.fn(async () => {
			steps.push("bootstrap");
		});
		const opening = (name: string) => ({
			connection: source({ name }),
			connect: async () => {
				steps.push(`connect ${name}`);
			},
			synchronize: async () => {},
			seed: async () => {},
		});
		const sources = [opening("orders"), opening("audit")];

		await dataSources.open(sources, {
			applicationName: "api",
			bootstrap,
			nodeEnv: "production",
		});

		expect(bootstrap).toHaveBeenCalledWith(
			sources.map((s) => s.connection),
			{ applicationName: "api", nodeEnv: "production" },
		);
		expect(steps).toEqual(["bootstrap", "connect orders", "connect audit"]);
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
			open: async () => {},
			diff: async () => ({ up: [], down: [] }),
		};
		return {
			steps,
			source: {
				connection,
				migrations: target,
				connect: async () => {},
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
