// The unit-of-work contract, run on the SQL providers against real Postgres. MikroORM's own unit of
// work is the reference: its writes are snapshotted, so an upgrade that changes them shows here,
// and data's tracker (under TypeORM) must send the same writes. Each case also checks the outcome.
// The cases are in ./contract/cases.ts; the memory provider runs them in unit-of-work.contract.spec.ts.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type PostgresContainer,
	startPostgres,
} from "../../data-postgres/tests/postgres-container.js";
import { cases, sqlCases } from "./contract/cases.js";
import { DDL, SCHEMA, TABLES } from "./contract/model.js";
import { openMikroOrm, openTypeOrm, type SqlProvider } from "./contract/providers.js";
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
		for (const p of providers ?? []) await p.close();
		await pg?.stop();
	});

	for (const { name, seed, run, check, checkSql } of [...cases, ...sqlCases]) {
		it(name, async () => {
			const sent: Record<string, string[]> = {};
			for (const p of providers) {
				await pg.superuser.query(
					`truncate ${TABLES.map((t) => `${SCHEMA}.${t}`).join(", ")} restart identity`,
				);
				if (seed) await seed(p);
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
