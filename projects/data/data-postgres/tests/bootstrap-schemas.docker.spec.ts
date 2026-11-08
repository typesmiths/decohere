import type { ConnectionInfo } from "@decohere/data";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapDataSources } from "../src/bootstrap.js";
import { type PostgresContainer, startPostgres } from "./postgres-container.js";

/**
 * Ledger's shape: one trusted dev server, one database, a schema per module, and a
 * migrate role that ends up owning the database. Needs Docker: runs under `pnpm test:docker`.
 */

const BOOTSTRAP_USER = "decohere_bootstrap";
const APP_USER = "ledger_app";
const MIGRATE_USER = "ledger_migrate";
const DATABASE = "ledger_dev";
const SCHEMAS = ["accounts", "liquidity"] as const;

describe("bootstrapDataSources against a trusted Postgres", () => {
	let postgres: PostgresContainer;

	beforeAll(async () => {
		postgres = await startPostgres({ trust: true });
		await postgres.superuser.query(
			`CREATE ROLE ${BOOTSTRAP_USER} LOGIN CREATEDB CREATEROLE NOSUPERUSER NOBYPASSRLS`,
		);
	}, 120_000);

	afterAll(async () => {
		await postgres?.stop();
	});

	function dataSource(schema: string): ConnectionInfo {
		return {
			name: schema,
			provider: "postgres",
			host: postgres.host,
			port: postgres.port,
			database: DATABASE,
			username: APP_USER,
			auth: "trust",
			schema,
			synchronize: true,
			seed: false,
			bootstrap: true,
			adminUser: BOOTSTRAP_USER,
			migrateUsername: MIGRATE_USER,
		};
	}

	function bootstrap() {
		return bootstrapDataSources(SCHEMAS.map(dataSource), {
			applicationName: "ledger.it",
			nodeEnv: "development",
		});
	}

	async function as<T>(user: string, work: (pool: Pool) => Promise<T>): Promise<T> {
		const pool = new Pool({
			host: postgres.host,
			port: postgres.port,
			user,
			database: DATABASE,
		});
		try {
			return await work(pool);
		} finally {
			await pool.end();
		}
	}

	/** Everything the bootstrap may touch, as text, so two runs can be compared. */
	async function catalogState() {
		return as(MIGRATE_USER, async (pool) => {
			const { rows } = await pool.query(`
				SELECT 'schema ' || nspname || ' owner=' || pg_get_userbyid(nspowner) || ' acl=' || coalesce(nspacl::text, '') AS line
				  FROM pg_namespace WHERE nspname IN ('public', 'accounts', 'liquidity')
				UNION ALL
				SELECT 'database owner=' || pg_get_userbyid(datdba) || ' acl=' || coalesce(datacl::text, '')
				  FROM pg_database WHERE datname = current_database()
				UNION ALL
				SELECT 'default ' || pg_get_userbyid(defaclrole) || ' ' || defaclnamespace::regnamespace::text
				       || ' ' || defaclobjtype::text || ' ' || defaclacl::text
				  FROM pg_default_acl
				UNION ALL
				SELECT 'member ' || pg_get_userbyid(member) || ' of ' || pg_get_userbyid(roleid)
				       || ' admin=' || admin_option || ' inherit=' || inherit_option || ' set=' || set_option
				  FROM pg_auth_members
				 WHERE pg_get_userbyid(member) IN ('${BOOTSTRAP_USER}', '${APP_USER}', '${MIGRATE_USER}')
				ORDER BY 1`);
			return rows.map((row: { line: string }) => row.line);
		});
	}

	it("creates the database, the roles and each schema, and lets the app role work in them", async () => {
		await bootstrap();

		const owners = await as(APP_USER, async (pool) => {
			const { rows } = await pool.query(
				`SELECT nspname, pg_get_userbyid(nspowner) AS owner FROM pg_namespace
				  WHERE nspname = ANY($1) ORDER BY nspname`,
				[SCHEMAS],
			);
			return rows;
		});
		expect(owners).toEqual([
			{ nspname: "accounts", owner: MIGRATE_USER },
			{ nspname: "liquidity", owner: MIGRATE_USER },
		]);

		// synchronize: the app role creates its own tables in each schema.
		for (const schema of SCHEMAS) {
			await as(APP_USER, (pool) =>
				pool.query(
					`CREATE TABLE ${schema}.synced (id int); INSERT INTO ${schema}.synced VALUES (1)`,
				),
			);
		}

		// Default privileges apply in the named schemas: tables the migrate role creates there
		// are readable and writable by the app role.
		for (const schema of SCHEMAS) {
			await as(MIGRATE_USER, (pool) => pool.query(`CREATE TABLE ${schema}.migrated (id int)`));
			await as(APP_USER, (pool) =>
				pool.query(
					`INSERT INTO ${schema}.migrated VALUES (1); SELECT * FROM ${schema}.migrated`,
				),
			);
		}
	});

	it("changes nothing when run again, now that the migrate role owns the database", async () => {
		const before = await catalogState();
		expect(before.find((line) => line.startsWith("database "))).toMatch(
			new RegExp(`^database owner=${MIGRATE_USER} `),
		);
		// The admin gives back the roles it borrowed: it keeps no membership that lends it their rights.
		expect(before.filter((line) => line.startsWith(`member ${BOOTSTRAP_USER} `))).not.toEqual(
			expect.arrayContaining([expect.stringContaining("inherit=true")]),
		);

		await bootstrap();

		expect(await catalogState()).toEqual(before);
	});
});
