import type { ConnectionInfo } from "@decohere/data";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { PoolMock, connectMock, queryMock } = vi.hoisted(() => {
	const connectMock = vi.fn();
	const queryMock = vi.fn();
	const PoolMock = vi.fn(function Pool(
		this: { connect: typeof connectMock; query: typeof queryMock; end: () => Promise<void> },
		_options: unknown,
	) {
		this.connect = connectMock;
		this.query = queryMock;
		this.end = async () => {};
		return this;
	});
	return { PoolMock, connectMock, queryMock };
});

vi.mock("pg", () => ({ Pool: PoolMock }));

import {
	assertBootstrapCredentials,
	assertDataSourceAuth,
	shouldBootstrapDatabase,
} from "../../src/postgres/bootstrap-policy.js";
import { createUserQuery } from "../../src/postgres/user-scripts.js";
import { PostgresServerManager } from "../../src/postgres/server-manager.js";

// A local dev Postgres that trusts every connection has no passwords at all, and says so
// with auth: trust.
function trustedInfo(overrides: Partial<ConnectionInfo> = {}): ConnectionInfo {
	return {
		name: "api",
		provider: "postgres",
		host: "postgres",
		port: 5432,
		database: "crypto_api_dev",
		synchronize: true,
		seed: true,
		username: "crypto_api_app",
		auth: "trust",
		migrateUsername: "crypto_api_migrate",
		adminUser: "decohere_bootstrap",
		...overrides,
	};
}

function sqlSent(): string[] {
	return queryMock.mock.calls.map((call) => String(call[0]));
}

describe("trust auth is declared, never guessed", () => {
	beforeEach(() => {
		PoolMock.mockClear();
		connectMock.mockReset();
		connectMock.mockResolvedValue({ release: vi.fn() });
		queryMock.mockReset();
		queryMock.mockImplementation(async (sql: string) =>
			sql.includes("datdba")
				? { rowCount: 1, rows: [{ owner: "decohere_bootstrap" }] }
				: { rowCount: 0, rows: [] },
		);
	});

	describe("checking a data source's auth", () => {
		it("accepts auth: trust with no passwords in development", () => {
			expect(() => assertDataSourceAuth(trustedInfo(), "development")).not.toThrow();
		});

		it("refuses auth: trust outside development", () => {
			expect(() => assertDataSourceAuth(trustedInfo(), "production")).toThrow(
				/Data source "api" sets auth: trust, which is allowed only in development/,
			);
		});

		it("refuses a missing password without auth: trust, in development too", () => {
			for (const env of ["development", "production"]) {
				expect(() => assertDataSourceAuth(trustedInfo({ auth: undefined }), env)).toThrow(
					/Data source "api" has no password\. Set password, or auth: trust/,
				);
			}
		});

		it("treats an empty password as missing", () => {
			expect(() =>
				assertDataSourceAuth(trustedInfo({ auth: "password", password: "" }), "development"),
			).toThrow(/has no password/);
		});

		it("accepts a password without auth, in any environment", () => {
			expect(() =>
				assertDataSourceAuth(
					trustedInfo({ auth: undefined, password: "s3cret" }),
					"production",
				),
			).not.toThrow();
		});

		it("refuses an auth it does not know", () => {
			expect(() =>
				assertDataSourceAuth(
					trustedInfo({ auth: "md5" as ConnectionInfo["auth"] }),
					"development",
				),
			).toThrow(/auth must be "password" or "trust" \(got "md5"\)/);
		});

		it("refuses a migrate role with no password when bootstrapping without auth: trust", () => {
			expect(() =>
				assertBootstrapCredentials(trustedInfo({ auth: undefined, password: "s3cret" })),
			).toThrow(/Data source "api" has migrateUsername but no migratePassword/);
			expect(() => assertBootstrapCredentials(trustedInfo())).not.toThrow();
		});
	});

	describe("creating a role", () => {
		it("leaves PASSWORD out when no password is given", () => {
			const { text } = createUserQuery("crypto_api_app");
			expect(text).toBe(
				'CREATE USER "crypto_api_app" WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE',
			);
		});

		it("treats a password a config file set to null as no password", () => {
			const { text } = createUserQuery("crypto_api_app", null);
			expect(text).not.toContain("PASSWORD");
		});

		it("still refuses an empty password, which is a typo and not a choice", () => {
			expect(() => createUserQuery("crypto_api_app", "")).toThrow(/Invalid password/);
		});
	});

	describe("deciding to bootstrap", () => {
		it("bootstraps in development with auth: trust and no admin password", () => {
			expect(shouldBootstrapDatabase(trustedInfo(), "development")).toBe(true);
		});

		it("no longer lets development alone stand in for an admin password", () => {
			expect(shouldBootstrapDatabase(trustedInfo({ auth: undefined }), "development")).toBe(
				false,
			);
			expect(() =>
				shouldBootstrapDatabase(
					trustedInfo({ auth: undefined, bootstrap: true }),
					"development",
				),
			).toThrow(/adminPassword may be left out only with auth: trust/);
		});

		it("still needs an admin user", () => {
			expect(
				shouldBootstrapDatabase(trustedInfo({ adminUser: undefined }), "development"),
			).toBe(false);
		});
	});

	describe("connecting as the bootstrap role", () => {
		it("connects with no password when the server is trusted", async () => {
			const manager = new PostgresServerManager("crypto", trustedInfo());
			await manager.connect();

			const options = PoolMock.mock.calls[0]?.[0] as { user: string; password?: string };
			expect(options.user).toBe("decohere_bootstrap");
			expect(options.password).toBeUndefined();
		});

		it("asks for the admin password when the server is not trusted", async () => {
			const manager = new PostgresServerManager("crypto", trustedInfo({ auth: undefined }));
			await expect(manager.connect()).rejects.toThrow(/adminUser and adminPassword/);
			expect(PoolMock).not.toHaveBeenCalled();
		});
	});

	describe("provisioning the app and migrate roles", () => {
		it("creates both without a PASSWORD clause when the server is trusted", async () => {
			const manager = new PostgresServerManager("crypto", trustedInfo());
			await manager.provisionRoles({
				database: "crypto_api_dev",
				appUsername: "crypto_api_app",
				migrateUsername: "crypto_api_migrate",
				allowAppDdl: false,
			});

			const creates = sqlSent().filter((sql) => sql.startsWith("CREATE USER"));
			expect(creates).toHaveLength(2);
			for (const sql of creates) {
				expect(sql).not.toContain("PASSWORD");
			}
		});

		it("still sets a password on a role that was given one", async () => {
			const manager = new PostgresServerManager("crypto", trustedInfo());
			await manager.provisionRoles({
				database: "crypto_api_dev",
				appUsername: "crypto_api_app",
				appPassword: "app-secret",
				allowAppDdl: false,
			});

			const create = sqlSent().find((sql) => sql.startsWith("CREATE USER"));
			expect(create).toContain("PASSWORD 'app-secret'");
		});

		it("refuses a role with no password when the server is not trusted", async () => {
			const manager = new PostgresServerManager("crypto", trustedInfo({ auth: undefined }));
			await expect(
				manager.provisionRoles({
					database: "crypto_api_prod",
					appUsername: "crypto_api_app",
					allowAppDdl: false,
				}),
			).rejects.toThrow(/password is required for database role "crypto_api_app"/i);
			expect(sqlSent().some((sql) => sql.startsWith("CREATE USER"))).toBe(false);
		});
	});
});
