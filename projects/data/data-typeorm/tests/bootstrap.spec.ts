import type { ConnectionInfo } from "@decohere/data";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { PoolMock, queryMock } = vi.hoisted(() => {
	const queryMock = vi.fn();
	const PoolMock = vi.fn(function Pool(
		this: {
			connect: () => Promise<{ release: () => void }>;
			query: typeof queryMock;
			end: () => Promise<void>;
		},
		_options: unknown,
	) {
		this.connect = async () => ({ release() {} });
		this.query = queryMock;
		this.end = async () => {};
		return this;
	});
	return { PoolMock, queryMock };
});

vi.mock("pg", () => ({ Pool: PoolMock }));

import { bootstrapDataSources } from "../src/bootstrap.js";

/** Edges the real-Postgres suite (bootstrap-schemas.docker.spec.ts) does not see. */

function dataSource(overrides: Partial<ConnectionInfo> = {}): ConnectionInfo {
	return {
		name: "accounts",
		provider: "postgres",
		host: "postgres",
		port: 5432,
		database: "ledger_dev",
		username: "ledger_app",
		auth: "trust",
		schema: "accounts",
		synchronize: true,
		seed: false,
		bootstrap: true,
		adminUser: "decohere_bootstrap",
		...overrides,
	};
}

/** Pools opened on the maintenance database: one per server and database bootstrapped. */
function serverConnections(): number {
	return PoolMock.mock.calls.filter(
		(call) => (call[0] as { database: string }).database === "postgres",
	).length;
}

function sqlSent(): string[] {
	return queryMock.mock.calls.map((call) => String(call[0]));
}

let privilegesHeld = false;

describe("bootstrapDataSources", () => {
	beforeEach(() => {
		PoolMock.mockClear();
		queryMock.mockReset();
		privilegesHeld = false;
		queryMock.mockImplementation(async (sql: string) => {
			if (sql.includes("datdba"))
				return { rowCount: 1, rows: [{ owner: "decohere_bootstrap" }] };
			if (sql.includes("AS granted"))
				return { rowCount: 1, rows: [{ granted: privilegesHeld }] };
			return { rowCount: 0, rows: [] };
		});
	});

	const options = { applicationName: "ledger", nodeEnv: "development" };

	it("bootstraps data sources that share a server and database once", async () => {
		await bootstrapDataSources(
			[
				dataSource(),
				dataSource({ name: "liquidity", schema: "liquidity" }),
				dataSource({ name: "other", database: "other_dev", schema: undefined }),
			],
			options,
		);

		expect(serverConnections()).toBe(2);
		expect(sqlSent().filter((sql) => sql.startsWith("CREATE SCHEMA"))).toEqual([
			'CREATE SCHEMA IF NOT EXISTS "accounts" AUTHORIZATION "decohere_bootstrap"',
			'CREATE SCHEMA IF NOT EXISTS "liquidity" AUTHORIZATION "decohere_bootstrap"',
			'CREATE SCHEMA IF NOT EXISTS "public" AUTHORIZATION "decohere_bootstrap"',
		]);
	});

	it("grants on the data source's schema, not on public", async () => {
		await bootstrapDataSources([dataSource()], options);

		const grants = sqlSent().filter((sql) => sql.startsWith("GRANT"));
		expect(grants).toEqual([
			'GRANT CONNECT ON DATABASE "ledger_dev" TO "ledger_app"',
			'GRANT USAGE ON SCHEMA "accounts" TO "ledger_app"',
			'GRANT CREATE ON SCHEMA "accounts" TO "ledger_app"',
		]);
	});

	it("grants nothing the roles already hold", async () => {
		privilegesHeld = true;
		await bootstrapDataSources([dataSource({ migrateUsername: "ledger_migrate" })], options);

		expect(sqlSent().filter((sql) => /^(GRANT|REVOKE)/.test(sql))).toEqual([]);
	});

	it("refuses data sources on one database that disagree on how to bootstrap it", async () => {
		await expect(
			bootstrapDataSources(
				[dataSource(), dataSource({ name: "liquidity", migrateUsername: "ledger_migrate" })],
				options,
			),
		).rejects.toThrow(
			/Data sources "accounts" and "liquidity" share database postgres:5432\/ledger_dev but set different migrateUsername/,
		);
		expect(PoolMock).not.toHaveBeenCalled();
	});

	it("checks the auth of every data source, including those it does not bootstrap", async () => {
		await expect(
			bootstrapDataSources(
				[dataSource({ name: "readonly", bootstrap: false, auth: undefined })],
				options,
			),
		).rejects.toThrow(/Data source "readonly" has no password/);
		expect(PoolMock).not.toHaveBeenCalled();
	});

	it("refuses auth: trust outside development before connecting", async () => {
		await expect(
			bootstrapDataSources([dataSource()], {
				applicationName: "ledger",
				nodeEnv: "production",
			}),
		).rejects.toThrow(/sets auth: trust, which is allowed only in development/);
		expect(PoolMock).not.toHaveBeenCalled();
	});

	it("explains when the admin cannot act as the database owner", async () => {
		queryMock.mockImplementation(async (sql: string) => {
			if (sql.includes("datdba")) return { rowCount: 1, rows: [{ owner: "postgres" }] };
			if (sql.includes("AS granted")) return { rowCount: 1, rows: [{ granted: false }] };
			if (sql.startsWith('GRANT "postgres"'))
				throw new Error('permission denied to grant role "postgres"');
			return { rowCount: 0, rows: [] };
		});

		await expect(bootstrapDataSources([dataSource()], options)).rejects.toThrow(
			/Bootstrap role "decohere_bootstrap" cannot act as "postgres"/,
		);
	});
});
