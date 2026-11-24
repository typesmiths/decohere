// The unit-of-work contract, run on the SQL providers against real Postgres. MikroORM's own unit of
// work is the reference: its writes are snapshotted, so an upgrade that changes them shows here,
// and data's tracker (under TypeORM) must send the same writes. Each case also checks the outcome.
// The cases are in ./contract/cases.ts; the memory provider runs them in unit-of-work.contract.spec.ts.
import type { App } from "@decohere/core/hosting";
import { injectable } from "@decohere/crucible/decorators";
import {
	DEFAULT_DATA_SOURCE,
	InvalidTransactionSettingError,
	type IUnitOfWork,
	type TransactionSettingsSource,
} from "@decohere/data";
import { mikroOrm } from "@decohere/data-mikro-orm";
import { typeOrm } from "@decohere/data-typeorm";
import { defineEntity, p } from "@mikro-orm/core";
import { EntitySchema } from "typeorm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
	type PostgresContainer,
	startPostgres,
} from "../../data-postgres/tests/postgres-container.js";
import { cases, sqlCases } from "./contract/cases.js";
import { DDL, SCHEMA, TABLES } from "./contract/model.js";
import {
	openMikroOrm,
	openTypeOrm,
	type SqlProvider,
	startApp,
} from "./contract/providers.js";
import { shapes } from "./contract/sql-shape.js";

describe("unit of work contract", () => {
	let pg: PostgresContainer;
	let providers: SqlProvider[];

	beforeAll(async () => {
		pg = await startPostgres();
		await pg.superuser.query(DDL);
		const connection = {
			host: pg.host,
			port: pg.port,
			user: "postgres",
			password: "postgres",
			database: "postgres",
		};
		// The reference first.
		providers = [await openMikroOrm(connection), await openTypeOrm(connection)];
	});

	afterAll(async () => {
		for (const p of providers ?? []) {
			await p.close();
		}
		await pg?.stop();
	});

	for (const { name, seed, run, check, checkSql } of [...cases, ...sqlCases]) {
		it(name, async () => {
			const sent: Record<string, string[]> = {};
			for (const p of providers) {
				await pg.superuser.query(
					`truncate ${TABLES.map((t) => `${SCHEMA}.${t}`).join(", ")} restart identity`,
				);
				if (seed) {
					await seed(p);
				}
				p.take();
				await run(p);
				const statements = p.take();
				checkSql?.(statements);
				sent[p.name] = shapes(statements);
				await check?.(p);
			}
			expect(sent.MikroORM).toMatchSnapshot();
			expect(sent.TypeORM).toEqual(sent.MikroORM);
		});
	}
});

// Transaction settings, for Postgres row-level security: a policy reads `app.tenant_id`, which each
// unit of work sets at the start of every transaction from the app's settings source. The app
// connects as a role that doesn't own the table, as row-level security needs (an owner skips it).
describe("transaction settings", () => {
	const T1 = "00000000-0000-4000-a000-0000000000c1";
	const T2 = "00000000-0000-4000-a000-0000000000c2";
	const TENANCY_DDL = `
		create role tenant_app login password 'tenant_app';
		create schema tenancy;
		grant usage on schema tenancy to tenant_app;
		create table tenancy.notes (id uuid primary key, tenant_id uuid not null, body text not null);
		alter table tenancy.notes enable row level security;
		create policy tenant_only on tenancy.notes
			using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
			with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
		grant select, insert, update, delete on tenancy.notes to tenant_app;
	`;

	class Note {
		public constructor(
			public id: string,
			public tenantId: string,
			public body: string,
		) {}
	}

	/** The app's source: the tenant of the request, set once the app knows it. */
	@injectable()
	class TenantSettings implements TransactionSettingsSource {
		public tenant: string | undefined;
		public name = "app.tenant_id";

		public transactionSettings() {
			return this.tenant == null ? {} : { [this.name]: this.tenant };
		}
	}

	const mappings = {
		MikroORM: (settings: typeof TenantSettings) =>
			mikroOrm({
				settings,
				entities: [
					defineEntity({
						class: Note,
						tableName: "notes",
						schema: "tenancy",
						properties: {
							id: p.uuid().primary(),
							tenantId: p.uuid().fieldName("tenant_id"),
							body: p.text(),
						},
					}),
				],
			}),
		TypeORM: (settings: typeof TenantSettings) =>
			typeOrm({
				settings,
				entities: [
					new EntitySchema<Note>({
						name: "Note",
						target: Note,
						tableName: "notes",
						schema: "tenancy",
						columns: {
							id: { type: "uuid", primary: true },
							tenantId: { type: "uuid", name: "tenant_id" },
							body: { type: "text" },
						},
					}),
				],
			}),
	};

	let pg: PostgresContainer;
	const apps: Record<string, App> = {};

	beforeAll(async () => {
		pg = await startPostgres();
		await pg.superuser.query(TENANCY_DDL);
		const connection = {
			host: pg.host,
			port: pg.port,
			user: "tenant_app",
			password: "tenant_app",
			database: "postgres",
		};
		for (const [name, plugin] of Object.entries(mappings)) {
			apps[name] = await startApp(connection, (builder) =>
				builder
					.withServices((s) => s.registerRequestScoped(TenantSettings))
					.use(plugin(TenantSettings)),
			);
		}
	});

	afterAll(async () => {
		for (const app of Object.values(apps)) {
			await app[Symbol.asyncDispose]();
		}
		await pg?.stop();
	});

	beforeEach(async () => {
		await pg.superuser.query(`truncate tenancy.notes`);
		await pg.superuser.query(
			`insert into tenancy.notes (id, tenant_id, body) values
				('00000000-0000-4000-a000-000000000d01', $1, 'one'),
				('00000000-0000-4000-a000-000000000d02', $1, 'two'),
				('00000000-0000-4000-a000-000000000d03', $2, 'three')`,
			[T1, T2],
		);
	});

	/** A request's unit of work, its settings source naming `tenant`. */
	function begin(provider: string, tenant: string | undefined) {
		const scope = apps[provider].services.beginScope();
		scope.resolve(TenantSettings).tenant = tenant;
		const uow = scope.resolve<IUnitOfWork>(DEFAULT_DATA_SOURCE);
		return { scope, uow };
	}

	const tenantsOf = (notes: Note[]) => notes.map((n) => n.tenantId).sort();
	const newNote = (n: number, tenant: string) =>
		new Note(`00000000-0000-4000-a000-000000000e0${n}`, tenant, `new ${n}`);

	describe.each(Object.keys(mappings))("on %s", (provider) => {
		it("finds only the rows of the tenant its settings name", async () => {
			const { scope, uow } = begin(provider, T1);
			await using _ = scope;
			expect(tenantsOf(await uow.find(Note))).toEqual([T1, T1]);
		});

		it("finds nothing when no tenant is set", async () => {
			const { scope, uow } = begin(provider, undefined);
			await using _ = scope;
			expect(await uow.find(Note)).toEqual([]);
		});

		it("reads the settings when the transaction begins, not when the unit of work is made", async () => {
			const { scope, uow } = begin(provider, undefined);
			await using _ = scope;
			scope.resolve(TenantSettings).tenant = T2;
			expect(tenantsOf(await uow.find(Note))).toEqual([T2]);
		});

		it("writes a new row with no read before it", async () => {
			const { scope, uow } = begin(provider, T1);
			await using _ = scope;
			uow.add(newNote(1, T1));
			await uow.commit();
			const { rows } = await pg.superuser.query(
				`select tenant_id from tenancy.notes where body = 'new 1'`,
			);
			expect(rows).toEqual([{ tenant_id: T1 }]);
		});

		it("refuses a row for another tenant", async () => {
			const { scope, uow } = begin(provider, T1);
			await using _ = scope;
			uow.add(newNote(2, T2));
			await expect(uow.commit()).rejects.toThrow(/row-level security/);
		});

		it("still sees only its tenant after a commit", async () => {
			const { scope, uow } = begin(provider, T1);
			await using _ = scope;
			expect(tenantsOf(await uow.find(Note))).toEqual([T1, T1]);
			uow.add(newNote(3, T1));
			await uow.commit();
			expect(tenantsOf(await uow.find(Note))).toEqual([T1, T1, T1]);
		});

		it("keeps each unit's tenant to itself when they share the pool's connections", async () => {
			const expected = new Map<string | undefined, string[]>([
				[T1, [T1, T1]],
				[T2, [T2]],
				[undefined, []],
			]);
			const readAll = (tenants: (string | undefined)[]) =>
				Promise.all(
					tenants.map(async (tenant) => {
						const { scope, uow } = begin(provider, tenant);
						await using _ = scope;
						return { tenant, found: tenantsOf(await uow.find(Note)) };
					}),
				);
			// More at once than the pool holds, so every connection has served a tenant first.
			await readAll(Array.from({ length: 20 }, () => T1));
			const seen = await readAll(
				Array.from({ length: 30 }, (_, i) => [T1, T2, undefined][i % 3]),
			);
			for (const { tenant, found } of seen) {
				expect(found).toEqual(expected.get(tenant));
			}
		});

		it("refuses a setting that isn't the app's own, such as the search path", async () => {
			const { scope, uow } = begin(provider, T1);
			await using _ = scope;
			scope.resolve(TenantSettings).name = "search_path";
			await expect(uow.find(Note)).rejects.toThrow(InvalidTransactionSettingError);
		});
	});
});
