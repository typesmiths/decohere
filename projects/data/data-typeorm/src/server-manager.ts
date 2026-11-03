import { type ConnectionInfo, DataConfigurationError } from "@decohere/data";
import { Pool } from "pg";
import {
	alterDatabaseOwnerQuery,
	createSchemaQuery,
	createUserQuery,
	databaseOwnerQuery,
	defaultPrivilegesForAppQueries,
	grantConnectQuery,
	grantRoleMembershipQuery,
	grantSchemaCreateQuery,
	grantSchemaPrivilegesQuery,
	grantSchemaUsageQuery,
	hasDatabasePrivilegeQuery,
	hasRolePrivilegesQuery,
	hasSchemaPrivilegeQuery,
	quoteIdent,
	revokeRoleMembershipQuery,
	roleExistsQuery,
	type SqlQuery,
} from "./scripts/user.js";

export type ProvisionRolesOptions = {
	database: string;
	appUsername: string;
	/** Omit only when the server is declared `auth: trust`. */
	appPassword?: string;
	migrateUsername?: string;
	migratePassword?: string;
	/** When true (TypeORM synchronize), grant CREATE on the schema to the app role (dev only). */
	allowAppDdl: boolean;
	/** The schema the app role works in, created when missing. Default `public`. */
	schema?: string;
};

/**
 * Official Postgres images always have this DB. `pg` defaults an omitted
 * `database` to the username — bootstrap roles like `decohere_bootstrap` are
 * not databases, so connect here before CREATE DATABASE.
 */
const MAINTENANCE_DATABASE = "postgres";

export class PostgresServerManager {
	private pool: Pool;
	private client: import("pg").PoolClient;

	public constructor(
		private readonly applicationName: string,
		private readonly config: ConnectionInfo,
	) {}

	/** `auth: trust`: the server lets every connection in, so roles have no password. */
	private get trusted(): boolean {
		return this.config.auth === "trust";
	}

	public async connect() {
		const { adminUser, adminPassword, host, port } = this.config;
		if (!adminUser || (!adminPassword && !this.trusted)) {
			throw new DataConfigurationError(
				`Data source "${this.config.name}": adminUser and adminPassword are required to bootstrap the database (adminPassword may be left out only with auth: trust)`,
			);
		}
		this.pool = new Pool({
			user: adminUser,
			host,
			password: adminPassword,
			port,
			database: MAINTENANCE_DATABASE,
			application_name: this.applicationName,
		});
		try {
			this.client = await this.pool.connect();
		} catch (err) {
			const cause = err instanceof Error ? err.message : String(err);
			throw new DataConfigurationError(
				`Cannot connect to PostgreSQL at ${host}:${port}. Is the server running? Cause: ${cause}`,
			);
		}
	}

	public async initializeDatabase(database: string) {
		quoteIdent(database, "database");
		const result = await this.pool.query(
			`SELECT datname FROM pg_catalog.pg_database WHERE lower(datname) = lower($1)`,
			[database],
		);
		if (result.rowCount === 1) {
			return;
		}

		const dbIdent = quoteIdent(database, "database");
		await this.pool.query(`CREATE DATABASE ${dbIdent}`);
	}

	/**
	 * Create the runtime app role (+ optional migrate role) and its schema, with least-privilege
	 * grants. Running it again changes nothing: each grant is made only where the role lacks it,
	 * since Postgres checks the grantor's rights even for a grant that would change nothing.
	 *
	 * The admin acts with the database owner's rights while it runs (it is made a member of the
	 * owner, and of the migrate role, only for as long as it needs to be). That is how it creates a
	 * schema and grants on it once the migrate role owns the database.
	 */
	public async provisionRoles(options: ProvisionRolesOptions): Promise<void> {
		const {
			database,
			appUsername,
			appPassword,
			migrateUsername,
			migratePassword,
			allowAppDdl,
			schema = "public",
		} = options;
		quoteIdent(schema, "schema");

		if (appUsername === this.config.adminUser) {
			throw new DataConfigurationError(
				`Runtime username "${appUsername}" must not equal adminUser — use a dedicated app role`,
			);
		}
		if (migrateUsername && migrateUsername === appUsername) {
			throw new DataConfigurationError(
				"migrateUsername must differ from the runtime app username",
			);
		}
		if (migrateUsername && migrateUsername === this.config.adminUser) {
			throw new DataConfigurationError("migrateUsername must not equal adminUser");
		}

		const adminUser = this.config.adminUser;
		if (!adminUser) {
			throw new DataConfigurationError("adminUser is required to provision database roles");
		}

		const pool = new Pool({
			host: this.config.host,
			port: this.config.port,
			user: adminUser,
			database,
			password: this.config.adminPassword,
			application_name: this.applicationName,
		});

		try {
			await using roles = new BorrowedRoles(pool, adminUser);

			if (migrateUsername) {
				await this.ensureRole(pool, migrateUsername, migratePassword);
				// Membership is required for OWNER TO and DEFAULT PRIVILEGES FOR ROLE (not superuser).
				await roles.borrow(migrateUsername);
				// The owner holds every privilege on the database, so no separate GRANT is needed.
				if ((await databaseOwner(pool, database)) !== migrateUsername) {
					await pool.query(alterDatabaseOwnerQuery(database, migrateUsername).text);
				}
			}

			const owner = await databaseOwner(pool, database);
			if (owner !== adminUser) await roles.borrow(owner);

			// Owned by the database owner (the migrate role, when there is one), like `public`.
			await pool.query(createSchemaQuery(schema, owner).text);

			if (
				migrateUsername &&
				!(await hasAll(pool, (privilege) =>
					hasSchemaPrivilegeQuery(migrateUsername, schema, privilege),
				))
			) {
				await pool.query(grantSchemaPrivilegesQuery(migrateUsername, schema).text);
			}

			await this.ensureRole(pool, appUsername, appPassword);
			if (
				!(await granted(pool, hasDatabasePrivilegeQuery(appUsername, database, "CONNECT")))
			) {
				await pool.query(grantConnectQuery(appUsername, database).text);
			}
			if (!(await granted(pool, hasSchemaPrivilegeQuery(appUsername, schema, "USAGE")))) {
				await pool.query(grantSchemaUsageQuery(appUsername, schema).text);
			}
			// Dev synchronize: the app connection must be able to CREATE tables.
			if (
				allowAppDdl &&
				!(await granted(pool, hasSchemaPrivilegeQuery(appUsername, schema, "CREATE")))
			) {
				await pool.query(grantSchemaCreateQuery(appUsername, schema).text);
			}

			if (migrateUsername) {
				// Setting a default privilege that is already set changes nothing.
				for (const q of defaultPrivilegesForAppQueries(migrateUsername, appUsername, schema)) {
					await pool.query(q.text);
				}
			}
		} finally {
			await pool.end();
		}
	}

	/** @deprecated Use provisionRoles. */
	public async createApiUser(
		username: string,
		password: string,
		database: string,
		_role?: string,
	) {
		await this.provisionRoles({
			database,
			appUsername: username,
			appPassword: password,
			migrateUsername: this.config.migrateUsername,
			migratePassword: this.config.migratePassword,
			allowAppDdl: this.config.synchronize === true,
			schema: this.config.schema,
		});
	}

	private async ensureRole(pool: Pool, username: string, password?: string): Promise<void> {
		if (!password && !this.trusted) {
			throw new DataConfigurationError(
				`A password is required for database role "${username}" unless the data source sets auth: trust`,
			);
		}
		const exists = roleExistsQuery(username);
		const found = await pool.query(exists.text, exists.values);
		if (found.rowCount === 1) {
			return;
		}
		const create = createUserQuery(username, password);
		await pool.query(create.text, create.values);
	}

	public [Symbol.asyncDispose]() {
		return this.closeConnection();
	}

	public async closeConnection() {
		this.client?.release();
		await this.pool?.end();
	}
}

async function granted(pool: Pool, query: SqlQuery): Promise<boolean> {
	const result = await pool.query(query.text, query.values);
	return result.rows[0]?.granted === true;
}

/** Every schema privilege that `GRANT ALL ON SCHEMA` gives. Checked one at a time: Postgres
 * answers true for a list when any one of them is held. */
async function hasAll(pool: Pool, query: (privilege: string) => SqlQuery): Promise<boolean> {
	for (const privilege of ["USAGE", "CREATE"]) {
		if (!(await granted(pool, query(privilege)))) return false;
	}
	return true;
}

async function databaseOwner(pool: Pool, database: string): Promise<string> {
	const query = databaseOwnerQuery(database);
	const result = await pool.query(query.text, query.values);
	const owner: string | undefined = result.rows[0]?.owner;
	if (owner == null) {
		throw new DataConfigurationError(`Database "${database}" does not exist`);
	}
	return owner;
}

/**
 * Roles the admin is made a member of for one provisioning run, so it acts with their rights.
 * Disposing gives back exactly what was borrowed, even when the run fails: memberships the admin
 * already had (or rights it has as a superuser) are left alone.
 */
class BorrowedRoles {
	private readonly borrowed: string[] = [];

	public constructor(
		private readonly pool: Pool,
		private readonly adminUser: string,
	) {}

	public async borrow(role: string): Promise<void> {
		if (this.borrowed.includes(role)) return;
		if (await granted(this.pool, hasRolePrivilegesQuery(this.adminUser, role))) return;
		try {
			await this.pool.query(grantRoleMembershipQuery(this.adminUser, role).text);
		} catch (err) {
			throw new DataConfigurationError(
				`Bootstrap role "${this.adminUser}" cannot act as "${role}". Make it a member of "${role}" (or create "${role}" with it), then run again.`,
				{ cause: err },
			);
		}
		this.borrowed.push(role);
	}

	public async [Symbol.asyncDispose](): Promise<void> {
		for (const role of this.borrowed.reverse()) {
			await this.pool.query(revokeRoleMembershipQuery(this.adminUser, role).text);
		}
	}
}
