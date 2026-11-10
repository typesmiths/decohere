import {
	type ConnectionInfo,
	DataConfigurationError,
	type Migration,
	type MigrationContext,
	MigrationError,
	type MigrationRow,
	type MigrationSource,
	type MigrationState,
	type MigrateOptions,
	type Migrator,
	type RevertOptions,
} from "@decohere/data";
import { Client } from "pg";
import { quoteIdent } from "./user-scripts.js";

const HISTORY = "decohere_migrations";

type Session = {
	client: Client;
	/** `"schema"."decohere_migrations"` */
	table: string;
};

/** The migrate role when the data source has one; the app role otherwise. */
function migrateRole(info: ConnectionInfo) {
	const user = info.migrateUsername || info.username;
	const password =
		info.auth === "trust"
			? undefined
			: info.migrateUsername
				? info.migratePassword
				: info.password;
	return { user, password };
}

async function connect(source: MigrationSource): Promise<Session> {
	const { connection } = source;
	const schema = connection.schema ?? "public";
	const client = new Client({
		host: connection.host,
		port: connection.port,
		database: connection.database,
		...migrateRole(connection),
		application_name: source.applicationName,
	});
	await client.connect();
	try {
		// Generated SQL may name objects without their schema (MikroORM's index renames do).
		await client.query(`set search_path to ${quoteIdent(schema, "schema")}`);
	} catch (error) {
		await client.end();
		throw error;
	}
	return { client, table: `${quoteIdent(schema, "schema")}.${HISTORY}` };
}

async function withSession<T>(
	source: MigrationSource,
	work: (session: Session) => Promise<T>,
) {
	const session = await connect(source);
	try {
		return await work(session);
	} finally {
		await session.client.end();
	}
}

/**
 * Hold the history table's advisory lock for `work`. A second run waits here, then finds the
 * first run's migrations in the history. The lock is the connection's: it goes when the connection does.
 */
async function locked<T>(session: Session, work: () => Promise<T>): Promise<T> {
	await session.client.query("select pg_advisory_lock(hashtext($1))", [session.table]);
	try {
		await session.client.query(
			`create table if not exists ${session.table} (id text primary key, applied_at timestamptz not null default now())`,
		);
		return await work();
	} finally {
		await session.client.query("select pg_advisory_unlock(hashtext($1))", [session.table]);
	}
}

async function history(session: Session): Promise<Map<string, Date>> {
	const exists = await session.client.query<{ found: string | null }>(
		"select to_regclass($1) as found",
		[session.table],
	);
	if (exists.rows[0]?.found == null) return new Map();
	const rows = await session.client.query<{ id: string; applied_at: Date }>(
		`select id, applied_at from ${session.table}`,
	);
	return new Map(rows.rows.map((row) => [row.id, row.applied_at]));
}

function inOrder(migrations: readonly Migration[]): Migration[] {
	const seen = new Set<string>();
	for (const { id } of migrations) {
		if (seen.has(id)) throw new DataConfigurationError(`Two migrations have the id ${id}`);
		seen.add(id);
	}
	return [...migrations].sort((a, b) => a.id.localeCompare(b.id));
}

function context(session: Session, container: MigrateOptions["container"]): MigrationContext {
	const sql = async <R extends MigrationRow>(text: string, params?: unknown[]) =>
		(await session.client.query<R>(text, params)).rows;
	return {
		sql,
		container,
		async batch(select, size, each) {
			for (;;) {
				const rows = await sql(select, [size]);
				if (rows.length === 0) return;
				await each(rows as never);
			}
		},
	};
}

/** Run `work` in a transaction; on a throw, roll back and rethrow it as the migration's error. */
async function transaction(session: Session, id: string, work: () => Promise<void>) {
	await session.client.query("begin");
	try {
		await work();
		await session.client.query("commit");
	} catch (error) {
		await session.client.query("rollback");
		const message = error instanceof Error ? error.message : String(error);
		throw new MigrationError(id, `${message}. Rolled back.`, { cause: error });
	}
}

async function migrate(source: MigrationSource, options: MigrateOptions): Promise<string[]> {
	const migrations = inOrder(source.migrations);
	if (options.to != null && !migrations.some((m) => m.id === options.to)) {
		throw new DataConfigurationError(`No migration has the id ${options.to}`);
	}
	const upTo = (all: Migration[]) =>
		options.to == null
			? all
			: all.filter((m) => m.id.localeCompare(options.to as string) <= 0);

	return withSession(source, async (session) => {
		if (options.dryRun) {
			const applied = await history(session);
			const pending = upTo(migrations).filter((m) => !applied.has(m.id));
			for (const m of pending) options.log?.(`would apply ${m.id}`);
			return pending.map((m) => m.id);
		}
		return locked(session, async () => {
			// Read under the lock: a run that held it before us may have applied some.
			const applied = await history(session);
			const done: string[] = [];
			for (const m of upTo(migrations)) {
				if (applied.has(m.id)) continue;
				const started = performance.now();
				await transaction(session, m.id, async () => {
					await m.up(context(session, options.container));
					await session.client.query(`insert into ${session.table} (id) values ($1)`, [m.id]);
				});
				done.push(m.id);
				options.log?.(`applied ${m.id} (${Math.round(performance.now() - started)} ms)`);
			}
			return done;
		});
	});
}

async function revert(
	source: MigrationSource,
	options: RevertOptions,
): Promise<string | undefined> {
	const migrations = inOrder(source.migrations);
	return withSession(source, (session) =>
		locked(session, async () => {
			const last = await session.client.query<{ id: string }>(
				`select id from ${session.table} order by applied_at desc, id desc limit 1`,
			);
			const id = last.rows[0]?.id;
			if (id == null) return undefined;
			const migration = migrations.find((m) => m.id === id);
			if (migration == null) {
				throw new MigrationError(
					id,
					"is the last one applied, but no migration in the code has its id",
				);
			}
			const { down } = migration;
			if (down == null) throw new MigrationError(id, "has no down, so it can't be reverted");
			await transaction(session, id, async () => {
				await down(context(session, options.container));
				await session.client.query(`delete from ${session.table} where id = $1`, [id]);
			});
			options.log?.(`reverted ${id}`);
			return id;
		}),
	);
}

async function status(source: MigrationSource): Promise<MigrationState[]> {
	const migrations = inOrder(source.migrations);
	return withSession(source, async (session) => {
		const applied = await history(session);
		const known = new Set(migrations.map((m) => m.id));
		const states: MigrationState[] = migrations.map((m) => {
			const appliedAt = applied.get(m.id);
			return appliedAt == null
				? { id: m.id, state: "pending" }
				: { id: m.id, state: "applied", appliedAt };
		});
		for (const [id, appliedAt] of applied) {
			if (!known.has(id)) states.push({ id, state: "unknown", appliedAt });
		}
		return states.sort((a, b) => a.id.localeCompare(b.id));
	});
}

/**
 * Decohere's migrations on Postgres, on a plain `pg` connection as the data source's migrate role.
 * The history is a `decohere_migrations` table in the data source's schema, and a session
 * advisory lock on that table's name keeps two runs, from two instances starting together,
 * from applying the same migration twice.
 */
export const postgresMigrator: Migrator = { migrate, revert, status };
