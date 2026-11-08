// Decohere's migrations on a real Postgres, as the migrate role the bootstrap creates.
// Needs Docker: `pnpm test:docker`.
import type { IContainer } from "@decohere/core/composition";
import { ServiceContainerBuilder } from "@decohere/crucible";
import {
	type ConnectionInfo,
	defineMigration,
	type Migration,
	MigrationError,
	type MigrationSource,
} from "@decohere/data";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapDataSources, postgresMigrator } from "../src/index.js";
import { type PostgresContainer, startPostgres } from "./postgres-container.js";

/** A domain service a data migration resolves from the app's container. */
class ExpiryPolicy {
	public expiresAt(placedAt: Date): Date {
		return new Date(placedAt.getTime() + 24 * 60 * 60 * 1000);
	}
}

const createOrders = defineMigration({
	id: "20261110-090000-create-orders",
	async up({ sql }) {
		await sql("create table orders (id serial primary key, placed_at timestamptz not null)");
		await sql(
			"insert into orders (placed_at) select timestamptz '2026-11-01T00:00:00Z' + n * interval '1 hour' from generate_series(1, 7) n",
		);
	},
	async down({ sql }) {
		await sql("drop table orders");
	},
});

const addExpiry = defineMigration({
	id: "20261110-090100-add-expiry",
	async up({ sql }) {
		await sql("alter table orders add column expires_at timestamptz");
	},
	async down({ sql }) {
		await sql("alter table orders drop column expires_at");
	},
});

const backfillExpiry = defineMigration({
	id: "20261110-090200-backfill-expiry",
	async up({ sql, container, batch }) {
		const policy = container.resolve(ExpiryPolicy);
		await batch<{ id: number; placed_at: Date }>(
			"select id, placed_at from orders where expires_at is null order by id limit $1",
			3,
			async (rows) => {
				for (const row of rows) {
					await sql("update orders set expires_at = $1 where id = $2", [
						policy.expiresAt(row.placed_at),
						row.id,
					]);
				}
			},
		);
	},
	async down({ sql }) {
		await sql("update orders set expires_at = null");
	},
});

describe("postgresMigrator", () => {
	let server: PostgresContainer;
	let container: IContainer;
	let databases = 0;

	beforeAll(async () => {
		server = await startPostgres();
		await server.superuser.query(
			"CREATE ROLE decohere_bootstrap LOGIN PASSWORD 'bootstrap-pw' CREATEDB CREATEROLE NOSUPERUSER NOBYPASSRLS",
		);
		const services = new ServiceContainerBuilder();
		services.registerSingleton(ExpiryPolicy);
		container = services.build();
	});

	afterAll(async () => {
		await server?.stop();
	});

	/** A fresh database with the shop's roles and schema, as the bootstrap makes them. */
	async function freshSource(migrations: Migration[]): Promise<MigrationSource> {
		databases += 1;
		const connection: ConnectionInfo = {
			name: "shop",
			provider: "postgres",
			host: server.host,
			port: server.port,
			database: `shop_${databases}`,
			username: "shop_app",
			password: "app-pw",
			schema: "shop",
			synchronize: false,
			seed: false,
			bootstrap: true,
			adminUser: "decohere_bootstrap",
			adminPassword: "bootstrap-pw",
			migrateUsername: "shop_migrate",
			migratePassword: "migrate-pw",
		};
		await bootstrapDataSources([connection], { applicationName: "shop.api" });
		return { connection, migrations, applicationName: "shop.api" };
	}

	/** Query the data source's database as the superuser. */
	async function query<R extends object>(source: MigrationSource, text: string): Promise<R[]> {
		const client = new Client({
			host: server.host,
			port: server.port,
			database: source.connection.database,
			user: "postgres",
			password: "postgres",
		});
		await client.connect();
		try {
			return (await client.query<R>(text)).rows;
		} finally {
			await client.end();
		}
	}

	it("applies, reverts and applies again, with a batched data migration using a container service", async () => {
		const source = await freshSource([backfillExpiry, createOrders, addExpiry]);
		const log: string[] = [];

		const applied = await postgresMigrator.migrate(source, {
			container,
			log: (line) => log.push(line),
		});
		expect(applied).toEqual([createOrders.id, addExpiry.id, backfillExpiry.id]);
		expect(log.map((line) => line.replace(/ \(\d+ ms\)$/, ""))).toEqual([
			`applied ${createOrders.id}`,
			`applied ${addExpiry.id}`,
			`applied ${backfillExpiry.id}`,
		]);
		const expiries = async () =>
			(
				await query<{ hours: number | null }>(
					source,
					"select extract(epoch from expires_at - placed_at) / 3600 as hours from shop.orders order by id",
				)
			).map((row) => (row.hours == null ? null : Number(row.hours)));
		expect(await expiries()).toEqual([24, 24, 24, 24, 24, 24, 24]);

		expect(await postgresMigrator.revert(source, { container })).toBe(backfillExpiry.id);
		expect(await expiries()).toEqual([null, null, null, null, null, null, null]);

		expect(await postgresMigrator.migrate(source, { container })).toEqual([backfillExpiry.id]);
		expect(await expiries()).toEqual([24, 24, 24, 24, 24, 24, 24]);
		expect(await postgresMigrator.migrate(source, { container })).toEqual([]);
	});

	it("keeps the history in the data source's schema, and runs as its migrate role", async () => {
		let ranAs: unknown;
		const whoAmI = defineMigration({
			id: "20261110-090000-who-am-i",
			async up({ sql }) {
				[ranAs] = await sql("select current_user as user, current_schema() as schema");
			},
		});
		const source = await freshSource([whoAmI]);

		await postgresMigrator.migrate(source, { container });

		expect(ranAs).toEqual({ user: "shop_migrate", schema: "shop" });
		expect(await query(source, "select id from shop.decohere_migrations")).toEqual([
			{ id: whoAmI.id },
		]);
	});

	it("applies each migration once when two runs start together", async () => {
		const slow = defineMigration({
			id: "20261110-090000-slow",
			async up({ sql }) {
				await sql("create table runs (at timestamptz not null default now())");
				await sql("select pg_sleep(0.5)");
				await sql("insert into runs default values");
			},
		});
		const source = await freshSource([slow, addExpiryToRuns]);

		const [first, second] = await Promise.all([
			postgresMigrator.migrate(source, { container }),
			postgresMigrator.migrate(source, { container }),
		]);

		expect([...first, ...second].sort()).toEqual([slow.id, addExpiryToRuns.id]);
		expect([first, second]).toContainEqual([]);
		expect(await query(source, "select count(*)::int as runs from shop.runs")).toEqual([
			{ runs: 1 },
		]);
	});

	it("rolls a failed migration back, records nothing for it, and keeps the ones before it", async () => {
		const broken = defineMigration({
			id: "20261110-090100-broken",
			async up({ sql }) {
				await sql("create table half_done (id int)");
				await sql("select * from no_such_table");
			},
		});
		const source = await freshSource([createOrders, broken]);

		const failure = postgresMigrator.migrate(source, { container });

		await expect(failure).rejects.toBeInstanceOf(MigrationError);
		await expect(failure).rejects.toThrow(
			`Migration ${broken.id}: relation "no_such_table" does not exist. Rolled back.`,
		);
		expect(await query(source, "select to_regclass('shop.half_done') as found")).toEqual([
			{ found: null },
		]);
		expect(await query(source, "select id from shop.decohere_migrations")).toEqual([
			{ id: createOrders.id },
		]);
	});

	it("reports applied, pending, and applied ids the code no longer has", async () => {
		const source = await freshSource([createOrders, addExpiry]);
		await postgresMigrator.migrate(source, { container, to: createOrders.id });
		// Applied from another branch: in the history, not in this code.
		await query(
			source,
			`insert into shop.decohere_migrations (id) values ('20261110-085900-from-another-branch')`,
		);

		const states = await postgresMigrator.status(source);

		expect(states.map(({ id, state }) => ({ id, state }))).toEqual([
			{ id: "20261110-085900-from-another-branch", state: "unknown" },
			{ id: createOrders.id, state: "applied" },
			{ id: addExpiry.id, state: "pending" },
		]);
	});

	it("says what a dry run would apply, and applies nothing", async () => {
		const source = await freshSource([createOrders, addExpiry]);
		const log: string[] = [];

		const wouldApply = await postgresMigrator.migrate(source, {
			container,
			dryRun: true,
			log: (line) => log.push(line),
		});

		expect(wouldApply).toEqual([createOrders.id, addExpiry.id]);
		expect(log).toEqual([`would apply ${createOrders.id}`, `would apply ${addExpiry.id}`]);
		expect(await query(source, "select to_regclass('shop.orders') as found")).toEqual([
			{ found: null },
		]);
	});

	it("refuses to revert a migration with no down", async () => {
		const oneWay = defineMigration({
			id: "20261110-090000-one-way",
			async up({ sql }) {
				await sql("create table one_way (id int)");
			},
		});
		const source = await freshSource([oneWay]);
		await postgresMigrator.migrate(source, { container });

		await expect(postgresMigrator.revert(source, { container })).rejects.toThrow(
			`Migration ${oneWay.id}: has no down, so it can't be reverted`,
		);
	});
});

const addExpiryToRuns = defineMigration({
	id: "20261110-090100-runs-note",
	async up({ sql }) {
		await sql("alter table runs add column note text");
	},
});
