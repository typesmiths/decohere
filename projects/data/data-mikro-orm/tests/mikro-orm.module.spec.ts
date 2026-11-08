import { ServiceContainerBuilder } from "@decohere/crucible";
import { DataConfigurationError, DatabaseConfig } from "@decohere/data";
import { describe, expect, it } from "vitest";
import { MikroOrmModule } from "../src/mikro-orm.module.js";

describe("MikroOrmModule", () => {
	it("refuses a data source that isn't Postgres, naming it", async () => {
		const databaseConfig = new DatabaseConfig();
		databaseConfig.dataSources = [
			{
				name: "reports",
				provider: "mssql",
				host: "127.0.0.1",
				port: 1433,
				database: "reports",
				username: "app",
				password: "secret",
				synchronize: false,
				seed: false,
				bootstrap: false,
			},
		];

		await expect(
			new MikroOrmModule().configure({
				applicationName: "reports.api",
				databaseConfig,
				moduleConfigurations: [{ entities: [] }],
				containerBuilder: new ServiceContainerBuilder(),
			}),
		).rejects.toThrow(
			new DataConfigurationError(
				"Data source reports: the MikroORM provider supports postgres, not mssql",
			),
		);
	});
});
