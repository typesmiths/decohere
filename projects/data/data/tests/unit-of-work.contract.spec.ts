// The unit-of-work contract on the memory provider: the cases the SQL providers pass against
// Postgres (unit-of-work.contract.docker.spec.ts), each on a fresh store, checked by outcome.
// There is no SQL to compare, and the cases that send SQL of their own (sqlCases) don't run here.
// They run on each mapping memory can take: its own, and TypeORM's and MikroORM's of the same model.
import "reflect-metadata";
import { describe, it } from "vitest";
import { cases } from "./contract/cases.js";
import { MEMORY_MAPPINGS, openMemory } from "./contract/memory.provider.js";

for (const [source, mapping] of Object.entries(MEMORY_MAPPINGS)) {
	describe(`unit of work contract on the memory provider, with ${source} mapping`, () => {
		for (const { name, seed, run, check } of cases) {
			it(name, async () => {
				const p = await openMemory(mapping);
				if (seed) {
					await seed(p);
				}
				p.reads();
				await run(p);
				await check?.(p);
			});
		}
	});
}
