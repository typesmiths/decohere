export type Dialect = "postgresql" | "tsql";
export type Provider = "postgres" | "mssql";

/**
 * How the server checks who connects, named as in pg_hba.conf.
 * - `password` (default): every role signs in with a password.
 * - `trust`: the server lets every connection in, so no role has a password. For a local dev
 *   server only; refused outside development.
 */
export type DatabaseAuth = "password" | "trust";

/**
 * Datasource connection settings.
 *
 * Privilege model (three roles):
 * - **username/password** — runtime app role (DML only in production).
 * - **migrateUsername/migratePassword** — migration/DDL role (CI/deploy only; not on API pods).
 * - **adminUser/adminPassword** — bootstrap role (`CREATEDB`/`CREATEROLE`, not superuser);
 *   used only when `bootstrap` is enabled (explicit or auto in development).
 */
export type ConnectionInfo = {
	name: string;
	provider: Provider;
	dialect?: Dialect;
	host: string;
	database: string;
	port: number;
	synchronize: boolean;
	/**
	 * Apply pending migrations when the app starts, before it serves. For development: elsewhere a
	 * release step runs `db migrate`, as the migrate role. Not with `synchronize`.
	 */
	migrateOnStart?: boolean;
	seed: boolean;
	/** Runtime app role (TypeORM connection). */
	username: string;
	/** Required unless `auth` is `trust`. */
	password?: string;
	/** Defaults to `password`. `trust` must be declared: a missing password never implies it. */
	auth?: DatabaseAuth;
	/**
	 * Schema this data source's tables live in (default `public`). Bootstrap creates it when
	 * missing and grants the app role access to it.
	 */
	schema?: string;
	/**
	 * When true, run prepareDatabase (create DB + roles) at API startup.
	 * When false, never bootstrap (production default).
	 * When omitted, bootstrap only if NODE_ENV is development/dev and admin creds are set.
	 */
	bootstrap?: boolean;
	/** Bootstrap / provisioner role — must not be the runtime app user. */
	adminUser?: string;
	/** Required to bootstrap unless `auth` is `trust`. */
	adminPassword?: string;
	/** Optional migration role for DDL; default privileges grant DML to the app user. */
	migrateUsername?: string;
	/** Required with `migrateUsername` when bootstrapping, unless `auth` is `trust`. */
	migratePassword?: string;
};
