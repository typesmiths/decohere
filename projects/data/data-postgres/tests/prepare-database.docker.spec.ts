import type { ConnectionInfo } from "@decohere/data";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgresServerManager } from "../src/server-manager.js";
import { type PostgresContainer, startPostgres } from "./postgres-container.js";

/**
 * Real-Postgres gate for scaffold-shaped bootstrap.
 * Catches bugs that SQL-shape / mocked-Pool tests miss (PASSWORD $1, missing maintenance DB).
 * Needs Docker: runs under `pnpm test:docker`, not `pnpm test`.
 */

const BOOTSTRAP_USER = "decohere_bootstrap";
const BOOTSTRAP_PASSWORD = "boot'strap-secret!";
const APP_USER = "crypto_api_app";
const APP_PASSWORD = "app'secret!";
const MIGRATE_USER = "crypto_api_migrate";
const MIGRATE_PASSWORD = "mig'secret!";
const APP_DATABASE = "crypto_api_dev";

describe("prepareDatabase against real Postgres", () => {
	let postgres: PostgresContainer;

	beforeAll(async () => {
		postgres = await startPostgres();
		await postgres.superuser.query(
			`CREATE ROLE ${BOOTSTRAP_USER} LOGIN PASSWORD '${BOOTSTRAP_PASSWORD.replaceAll("'", "''")}' CREATEDB CREATEROLE NOSUPERUSER NOBYPASSRLS`,
		);
		await postgres.superuser.query(`GRANT CONNECT ON DATABASE postgres TO ${BOOTSTRAP_USER}`);
	}, 120_000);

	afterAll(async () => {
		await postgres?.stop();
	});

	function connectionInfo(overrides: Partial<ConnectionInfo> = {}): ConnectionInfo {
		return {
			name: "api",
			provider: "postgres",
			host: postgres.host,
			port: postgres.port,
			database: APP_DATABASE,
			synchronize: true,
			seed: false,
			username: APP_USER,
			password: APP_PASSWORD,
			bootstrap: true,
			adminUser: BOOTSTRAP_USER,
			adminPassword: BOOTSTRAP_PASSWORD,
			migrateUsername: MIGRATE_USER,
			migratePassword: MIGRATE_PASSWORD,
			...overrides,
		};
	}

	it("connects as decohere_bootstrap, creates the app DB, and provisions app/migrate roles", async () => {
		await using manager = new PostgresServerManager("crypto-it", connectionInfo());
		await manager.connect();
		await manager.initializeDatabase(APP_DATABASE);
		await manager.provisionRoles({
			database: APP_DATABASE,
			appUsername: APP_USER,
			appPassword: APP_PASSWORD,
			migrateUsername: MIGRATE_USER,
			migratePassword: MIGRATE_PASSWORD,
			allowAppDdl: true,
		});

		const app = new Pool({
			host: postgres.host,
			port: postgres.port,
			user: APP_USER,
			password: APP_PASSWORD,
			database: APP_DATABASE,
		});
		try {
			const result = await app.query("SELECT 1 AS ok");
			expect(result.rows[0]?.ok).toBe(1);
		} finally {
			await app.end();
		}

		const migrate = new Pool({
			host: postgres.host,
			port: postgres.port,
			user: MIGRATE_USER,
			password: MIGRATE_PASSWORD,
			database: APP_DATABASE,
		});
		try {
			await migrate.query("CREATE TABLE IF NOT EXISTS it_probe (id int)");
		} finally {
			await migrate.end();
		}
	});
});
