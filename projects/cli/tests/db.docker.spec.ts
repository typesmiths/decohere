// `decohere db` against a real Postgres, as a developer runs it: an app's db.ts in a workspace,
// spawned by the CLI. Here, moving a database another tool already migrated onto Decohere's
// migrations: `db baseline` records what the database already has, without running it.
// Needs Docker: `pnpm test:docker`.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	type PostgresContainer,
	startPostgres,
} from "../../data/data-postgres/tests/postgres-container.js";

const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { tmpdir } = await vi.importActual<typeof import("node:os")>("node:os");
const { join } = await vi.importActual<typeof import("node:path")>("node:path");

const repo = fileURLToPath(new URL("../../../", import.meta.url));

/** The schema the old tool's migrations built, with a row its data migration added. */
const ALREADY_MIGRATED = `
	create type account_role as enum ('admin', 'member');
	create table account (id serial primary key, email text not null, role account_role not null default 'member');
	create unique index account_email on account (email);
	create table post (id serial primary key, account_id int not null);
	alter table post add constraint post_account foreign key (account_id) references account (id);
	insert into account (email, role) values ('owner@example.com', 'admin');
	create table migrations (id serial primary key, "timestamp" bigint not null, name varchar not null);
	insert into migrations ("timestamp", name) values (1794327166580, 'Init1794327166580'), (1794330000000, 'Owner1794330000000');
`;

/** The old migrations, converted: running them on the migrated database would fail. */
const MIGRATIONS: Record<string, string> = {
	"20261110-161246-init": `
		await sql("create type account_role as enum ('admin', 'member')");
		await sql("create table account (id serial primary key, email text not null, role account_role not null default 'member')");
		await sql("create unique index account_email on account (email)");
		await sql("create table post (id serial primary key, account_id int not null)");
		await sql("alter table post add constraint post_account foreign key (account_id) references account (id)");`,
	"20261110-170000-owner": `
		await sql("insert into account (email, role) values ('owner@example.com', 'admin')");`,
	"20261111-090000-add-title": `
		await sql("alter table post add column title text");`,
};

/** An app's db.ts: the TypeORM provider on Postgres, connecting where the test says. */
const DB_TS = `import { ConfigurationServiceToken } from "@decohere/core/configuration";
import { Builder } from "@decohere/core/hosting";
import { ServiceContainerBuilder } from "@decohere/crucible";
import { DatabaseConfig, db } from "@decohere/data";
import { postgres } from "@decohere/data-postgres";
import { typeOrm } from "@decohere/data-typeorm";
import { migrations } from "./migrations/index.js";

const env = (name: string) => process.env[name] ?? "";
const connection = {
	name: "shop", provider: "postgres" as const, host: env("SPEC_PG_HOST"), port: Number(env("SPEC_PG_PORT")),
	database: env("SPEC_PG_DATABASE"), username: "postgres", password: "postgres", synchronize: false, seed: false,
};
const configuration = {
	dataSources: [],
	async get<T extends object>(type: unknown): Promise<T> {
		const config = new DatabaseConfig();
		if (type === DatabaseConfig) config.dataSources = [connection];
		return config as unknown as T;
	},
};

const app = await Builder.create(new ServiceContainerBuilder(), { applicationName: "shop.api" })
	.withServices((c) => c.registerSingleton(ConfigurationServiceToken, configuration))
	.use(typeOrm({ entities: [], database: postgres, migrations }))
	.build();
try {
	await db.run(app, process.argv.slice(2), { directory: new URL("./migrations/", import.meta.url) });
} finally {
	await app.dispose();
}
`;

describe("decohere db on Postgres (real process)", () => {
	let server: PostgresContainer;
	let parent: string;
	let databases = 0;

	beforeAll(async () => {
		server = await startPostgres();
		parent = realFs.mkdtempSync(join(tmpdir(), "decohere-db-pg-"));
	});

	afterAll(async () => {
		realFs.rmSync(parent, { recursive: true, force: true });
		await server?.stop();
	});

	/** A workspace whose API has the given migrations, and an empty database for it. */
	async function workspace(ids: string[]) {
		databases += 1;
		const database = `shop_${databases}`;
		await server.superuser.query(`create database ${database}`);
		const ws = join(parent, database);
		const write = (relativePath: string, content: string) => {
			const file = join(ws, relativePath);
			realFs.mkdirSync(join(file, ".."), { recursive: true });
			realFs.writeFileSync(file, content);
		};
		write("package.json", JSON.stringify({ name: "ws", private: true, type: "module" }));
		write("tsconfig.json", JSON.stringify({ compilerOptions: { module: "nodenext" } }));
		write(
			"projects/api/package.json",
			JSON.stringify({ name: "@ws/api", type: "module", main: "src/main.ts" }),
		);
		write("projects/api/src/main.ts", "export {};\n");
		write("projects/api/src/db.ts", DB_TS);
		for (const id of ids) {
			write(
				`projects/api/src/migrations/${id}.ts`,
				`import { defineMigration } from "@decohere/data";\n\nexport default defineMigration({\n\tid: "${id}",\n\tasync up({ sql }) {${MIGRATIONS[id]}\n\t},\n});\n`,
			);
		}
		write(
			"projects/api/src/migrations/index.ts",
			`import type { Migration } from "@decohere/data";\n${ids.map((id, i) => `import m${i} from "./${id}.js";`).join("\n")}\n\nexport const migrations: Migration[] = [${ids.map((_, i) => `m${i}`).join(", ")}];\n`,
		);

		const sql = async <R extends object>(text: string): Promise<R[]> => {
			const client = new Client({
				host: server.host,
				port: server.port,
				database,
				user: "postgres",
				password: "postgres",
			});
			await client.connect();
			try {
				return (await client.query<R>(text)).rows;
			} finally {
				await client.end();
			}
		};

		const decohere = (...argv: string[]) => {
			const result = spawnSync(
				process.execPath,
				[
					"--import",
					join(repo, "tools/register.mjs"),
					join(repo, "projects/cli/src/cli.ts"),
					"db",
					...argv,
				],
				{
					cwd: ws,
					encoding: "utf8",
					timeout: 60_000,
					env: {
						...process.env,
						SPEC_PG_HOST: server.host,
						SPEC_PG_PORT: String(server.port),
						SPEC_PG_DATABASE: database,
					},
				},
			);
			/** The command's own report: status lines and the like, not the app's logs. */
			const report = result.stdout
				.split("\n")
				.filter((line) => /^(applied|pending|unknown|recorded|would|Nothing)\b/.test(line));
			return { status: result.status, report, output: result.stdout + result.stderr };
		};

		return { sql, decohere };
	}

	it("records an already-migrated database's migrations as applied, so migrate runs only the new ones", async () => {
		const ids = Object.keys(MIGRATIONS);
		const { sql, decohere } = await workspace(ids);
		await sql(ALREADY_MIGRATED);

		expect(decohere("baseline", "20261110-170000-owner").report).toEqual([
			"recorded 20261110-161246-init",
			"recorded 20261110-170000-owner",
		]);

		const status = decohere("status").report;
		expect(status.map((line) => line.split(/\s+/).slice(0, 2).join(" "))).toEqual([
			"applied 20261110-161246-init",
			"applied 20261110-170000-owner",
			"pending 20261111-090000-add-title",
		]);

		const migrate = decohere("migrate");
		expect(migrate.status, migrate.output).toBe(0);
		expect(migrate.report).toEqual([
			expect.stringMatching(/^applied 20261111-090000-add-title \(\d+ ms\)$/),
		]);
		expect(await sql("select email from account")).toEqual([{ email: "owner@example.com" }]);
		expect(decohere("migrate").report).toEqual(["Nothing to apply"]);
	});

	it("records nothing twice, and nothing at all with --dry-run", async () => {
		const { sql, decohere } = await workspace(Object.keys(MIGRATIONS));
		await sql(ALREADY_MIGRATED);

		expect(decohere("baseline", "20261110-170000-owner", "--dry-run").report).toEqual([
			"would record 20261110-161246-init",
			"would record 20261110-170000-owner",
		]);
		expect(await sql("select to_regclass('decohere_migrations') as found")).toEqual([
			{ found: null },
		]);

		decohere("baseline", "20261110-161246-init");
		expect(decohere("baseline", "20261110-170000-owner").report).toEqual([
			"recorded 20261110-170000-owner",
		]);
		expect(decohere("baseline", "20261110-170000-owner").report).toEqual([
			"Nothing to record",
		]);
	});

	it("refuses an id no migration has, or no id at all, and records nothing", async () => {
		const { sql, decohere } = await workspace(Object.keys(MIGRATIONS));

		const unknown = decohere("baseline", "20261110-170000-ownr");
		expect(unknown.status).toBe(1);
		expect(unknown.output).toContain("No migration has the id 20261110-170000-ownr");

		const missing = decohere("baseline");
		expect(missing.status).toBe(1);
		expect(missing.output).toContain("db baseline needs the id of the last migration");
		expect(await sql("select to_regclass('decohere_migrations') as found")).toEqual([
			{ found: null },
		]);
	});

	it("builds the same schema on an empty database with migrate", async () => {
		const { sql, decohere } = await workspace(Object.keys(MIGRATIONS));

		const migrate = decohere("migrate");

		expect(migrate.status, migrate.output).toBe(0);
		expect(migrate.report).toHaveLength(3);
		expect(await sql("select email, role from account")).toEqual([
			{ email: "owner@example.com", role: "admin" },
		]);
		expect(
			await sql(
				"select conname from pg_constraint where conrelid = 'post'::regclass and contype = 'f'",
			),
		).toEqual([{ conname: "post_account" }]);
	});
}, 300_000);
