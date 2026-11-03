/** Postgres identifier: letters, digits, underscore; must start with letter or underscore. */
const SAFE_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function assertSafeSqlIdent(value: string, label: string): string {
	if (typeof value !== "string" || value.length === 0 || !SAFE_IDENT.test(value)) {
		throw new Error(
			`Invalid ${label}: must match ${SAFE_IDENT} (got ${JSON.stringify(value)})`,
		);
	}
	return value;
}

/** Double-quote a validated identifier for use in DDL. */
export function quoteIdent(value: string, label = "identifier"): string {
	const safe = assertSafeSqlIdent(value, label);
	return `"${safe.replaceAll('"', '""')}"`;
}

/**
 * Single-quote a string literal for DDL that cannot take bind parameters
 * (e.g. CREATE USER … PASSWORD — Postgres rejects PASSWORD $1).
 */
export function quoteLiteral(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

export type SqlQuery = { text: string; values: unknown[] };

/** Existence check — username bound as $1 (never concatenated). */
export function roleExistsQuery(username: string): SqlQuery {
	assertSafeSqlIdent(username, "username");
	return {
		text: `SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $1`,
		values: [username],
	};
}

/**
 * CREATE USER with password as an escaped SQL literal.
 * Username is validated + quoted as an identifier (cannot be parameterized in DDL).
 * Password cannot use bind params in CREATE USER … PASSWORD (Postgres syntax error).
 *
 * `password` omitted (undefined) creates a role with no password, for a local dev server that
 * trusts every connection. An empty string is still an error: that is a typo, not a choice.
 * Callers decide when no password is allowed (see PostgresServerManager).
 */
export function createUserQuery(username: string, password?: string): SqlQuery {
	const userIdent = quoteIdent(username, "username");
	const attributes = "NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE";
	if (password === undefined) {
		return { text: `CREATE USER ${userIdent} WITH LOGIN ${attributes}`, values: [] };
	}
	if (typeof password !== "string" || password.length === 0) {
		throw new Error("Invalid password: must be a non-empty string");
	}
	const passwordLiteral = quoteLiteral(password);
	return {
		text: `CREATE USER ${userIdent} WITH LOGIN PASSWORD ${passwordLiteral} ${attributes}`,
		values: [],
	};
}

/** CONNECT only — production runtime app role. */
export function grantConnectQuery(username: string, database: string): SqlQuery {
	const userIdent = quoteIdent(username, "username");
	const dbIdent = quoteIdent(database, "database");
	return {
		text: `GRANT CONNECT ON DATABASE ${dbIdent} TO ${userIdent}`,
		values: [],
	};
}

export function grantSchemaUsageQuery(username: string, schema = "public"): SqlQuery {
	const userIdent = quoteIdent(username, "username");
	const schemaIdent = quoteIdent(schema, "schema");
	return {
		text: `GRANT USAGE ON SCHEMA ${schemaIdent} TO ${userIdent}`,
		values: [],
	};
}

/** Needed for TypeORM synchronize (dev only). */
export function grantSchemaCreateQuery(username: string, schema = "public"): SqlQuery {
	const userIdent = quoteIdent(username, "username");
	const schemaIdent = quoteIdent(schema, "schema");
	return {
		text: `GRANT CREATE ON SCHEMA ${schemaIdent} TO ${userIdent}`,
		values: [],
	};
}

/** The schema, owned by `owner`. Unchanged when it already exists. */
export function createSchemaQuery(schema: string, owner: string): SqlQuery {
	const schemaIdent = quoteIdent(schema, "schema");
	const ownerIdent = quoteIdent(owner, "owner");
	return {
		text: `CREATE SCHEMA IF NOT EXISTS ${schemaIdent} AUTHORIZATION ${ownerIdent}`,
		values: [],
	};
}

/**
 * Whether a role already holds a privilege. Postgres checks that the grantor may grant even when
 * the grant would change nothing, so bootstrap asks first and grants only what is missing.
 */
export function hasDatabasePrivilegeQuery(
	username: string,
	database: string,
	privilege: string,
): SqlQuery {
	assertSafeSqlIdent(username, "username");
	assertSafeSqlIdent(database, "database");
	return {
		text: `SELECT has_database_privilege($1, $2, $3) AS granted`,
		values: [username, database, privilege],
	};
}

export function hasSchemaPrivilegeQuery(
	username: string,
	schema: string,
	privilege: string,
): SqlQuery {
	assertSafeSqlIdent(username, "username");
	assertSafeSqlIdent(schema, "schema");
	return {
		text: `SELECT has_schema_privilege($1, $2, $3) AS granted`,
		values: [username, schema, privilege],
	};
}

/** Whether `member` already has the privileges of `role` (inherited, or as a superuser). */
export function hasRolePrivilegesQuery(member: string, role: string): SqlQuery {
	assertSafeSqlIdent(member, "member");
	assertSafeSqlIdent(role, "role");
	return {
		text: `SELECT pg_has_role($1, $2, 'USAGE') AS granted`,
		values: [member, role],
	};
}

export function databaseOwnerQuery(database: string): SqlQuery {
	assertSafeSqlIdent(database, "database");
	return {
		text: `SELECT pg_get_userbyid(datdba) AS owner FROM pg_catalog.pg_database WHERE datname = $1`,
		values: [database],
	};
}

export function grantSchemaPrivilegesQuery(username: string, schema = "public"): SqlQuery {
	const userIdent = quoteIdent(username, "username");
	const schemaIdent = quoteIdent(schema, "schema");
	return {
		text: `GRANT ALL ON SCHEMA ${schemaIdent} TO ${userIdent}`,
		values: [],
	};
}

export function alterDatabaseOwnerQuery(database: string, username: string): SqlQuery {
	const dbIdent = quoteIdent(database, "database");
	const userIdent = quoteIdent(username, "username");
	return {
		text: `ALTER DATABASE ${dbIdent} OWNER TO ${userIdent}`,
		values: [],
	};
}

/**
 * Postgres requires the session user to be a member of the target role to
 * `ALTER DATABASE … OWNER TO` / `ALTER DEFAULT PRIVILEGES FOR ROLE`.
 */
export function grantRoleMembershipQuery(member: string, role: string): SqlQuery {
	const memberIdent = quoteIdent(member, "member");
	const roleIdent = quoteIdent(role, "role");
	return {
		text: `GRANT ${roleIdent} TO ${memberIdent}`,
		values: [],
	};
}

export function revokeRoleMembershipQuery(member: string, role: string): SqlQuery {
	const memberIdent = quoteIdent(member, "member");
	const roleIdent = quoteIdent(role, "role");
	return {
		text: `REVOKE ${roleIdent} FROM ${memberIdent}`,
		values: [],
	};
}

/**
 * Future tables/sequences created by the migration role are usable by the app role (DML only).
 */
export function defaultPrivilegesForAppQueries(
	migrateUsername: string,
	appUsername: string,
	schema = "public",
): SqlQuery[] {
	const migrateIdent = quoteIdent(migrateUsername, "migrateUsername");
	const appIdent = quoteIdent(appUsername, "username");
	const schemaIdent = quoteIdent(schema, "schema");
	return [
		{
			text: `ALTER DEFAULT PRIVILEGES FOR ROLE ${migrateIdent} IN SCHEMA ${schemaIdent} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appIdent}`,
			values: [],
		},
		{
			text: `ALTER DEFAULT PRIVILEGES FOR ROLE ${migrateIdent} IN SCHEMA ${schemaIdent} GRANT USAGE, SELECT ON SEQUENCES TO ${appIdent}`,
			values: [],
		},
	];
}

/**
 * @deprecated Prefer discrete query helpers + PostgresServerManager.provisionRoles.
 * Kept for call-site / pen-test migration: emits create + CONNECT + USAGE (not ALL PRIVILEGES).
 */
const createOwnerUser = (username: string, password: string, database: string): SqlQuery => {
	quoteIdent(username, "username");
	quoteIdent(database, "database");
	if (typeof password !== "string" || password.length === 0) {
		throw new Error("Invalid password: must be a non-empty string");
	}
	const create = createUserQuery(username, password);
	const connect = grantConnectQuery(username, database);
	const usage = grantSchemaUsageQuery(username);
	return {
		text: [create.text, connect.text, usage.text].join(";\n"),
		values: [],
	};
};

const userExists = (username: string): SqlQuery => roleExistsQuery(username);

export const userScripts = { createOwnerUser, userExists };
