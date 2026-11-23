// An app that gives a data source its pg driver in code, as one that shares a pool between data
// sources does: config holds only plain data, so a driver (a class) can't go there. The app builds,
// starts, and its unit of work's queries go through that driver. Needs Docker: `pnpm test:docker`.
import "reflect-metadata";
import {
	ConfigurationServiceToken,
	type IConfigurationService,
} from "@decohere/core/configuration";
import { Builder } from "@decohere/core/hosting";
import type { Constructable } from "@decohere/core/reflection";
import { ServiceContainerBuilder } from "@decohere/crucible";
import {
	type ConnectionInfo,
	DatabaseConfig,
	DEFAULT_DATA_SOURCE,
	type IUnitOfWork,
} from "@decohere/data";
import pg from "pg";
import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { typeOrm } from "../src/index.js";
import {
	type PostgresContainer,
	startPostgres,
} from "../../data-postgres/tests/postgres-container.js";

@Entity({ name: "note" })
class Note {
	@PrimaryGeneratedColumn()
	public id!: number;

	@Column({ type: "text" })
	public text!: string;
}

class StaticConfig implements IConfigurationService {
	public readonly dataSources = [];
	public constructor(private readonly connection: ConnectionInfo) {}
	public async get<T extends object>(type: Constructable<T> | string): Promise<T> {
		const config = new DatabaseConfig();
		if (type === DatabaseConfig) config.dataSources = [this.connection];
		return config as unknown as T;
	}
}

describe("a data source given its driver in code", () => {
	let postgres: PostgresContainer;

	beforeAll(async () => {
		postgres = await startPostgres();
		await postgres.superuser.query(
			"create table note (id serial primary key, text text not null)",
		);
	});

	afterAll(async () => {
		await postgres?.stop();
	});

	it("builds, starts, and queries through that driver", async () => {
		// TypeORM builds its pool from the driver's Pool, so a pool built here is the one it queries.
		const pools: pg.Pool[] = [];
		class TrackedPool extends pg.Pool {
			public constructor(config?: pg.PoolConfig) {
				super(config);
				pools.push(this);
			}
		}
		const driver = { ...pg, Pool: TrackedPool };

		await using app = await Builder.create(new ServiceContainerBuilder())
			.withServices((c) =>
				c.registerSingleton(
					ConfigurationServiceToken,
					new StaticConfig({
						name: "notes",
						provider: "postgres",
						host: postgres.host,
						port: postgres.port,
						database: "postgres",
						username: "postgres",
						password: "postgres",
						synchronize: false,
						seed: false,
						bootstrap: false,
					}),
				),
			)
			.use(typeOrm({ entities: [Note], dataSourceOptions: { driver } }))
			.build();
		await app.start({ port: 0, shutdownSignals: false, startRetry: false });

		{
			await using scope = app.services.beginScope("a request");
			const uow = scope.resolve<IUnitOfWork>(DEFAULT_DATA_SOURCE);
			uow.add(Object.assign(new Note(), { text: "kept" }));
			await uow.commit();
		}
		await using scope = app.services.beginScope("a later request");
		const notes = await scope.resolve<IUnitOfWork>(DEFAULT_DATA_SOURCE).find(Note);
		expect(notes.map((n) => n.text)).toEqual(["kept"]);
		expect(pools).toHaveLength(1);
		expect(pools[0].totalCount).toBeGreaterThan(0);
	});
});
