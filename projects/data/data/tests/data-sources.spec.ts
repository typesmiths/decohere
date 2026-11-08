import { type ConnectionInfo, DataConfigurationError, dataSources } from "@decohere/data";
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
				'Data source "api" asks to be set up at startup (bootstrap), but the provider was given no bootstrap. Install the package for its database and pass it: bootstrap: postgres.bootstrap, from @decohere/data-postgres. Or set bootstrap: false.',
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
});
