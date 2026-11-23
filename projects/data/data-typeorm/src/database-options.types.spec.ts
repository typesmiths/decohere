// What `typeOrm({ entities })` takes is checked by the compiler, so a wrong one fails
// `pnpm run typecheck`: a class, or an `EntitySchema` mapping a class that imports no ORM. Not a
// file glob, which would have TypeORM load files on its own, outside flux.
import { EntitySchema } from "typeorm";
import { describe, expectTypeOf, it } from "vitest";
import { typeOrm } from "./typeorm.plugin.js";

class Pause {
	public account!: string;
	public on!: boolean;
}

const PAUSE = new EntitySchema<Pause>({
	name: "Pause",
	target: Pause,
	tableName: "halt",
	columns: { account: { type: "uuid", primary: true }, on: { type: "boolean" } },
});

type Entities = Parameters<typeof typeOrm>[0] extends infer C
	? C extends { entities: infer E }
		? E
		: never
	: never;

describe("typeOrm entities", () => {
	it("takes a class", () => {
		expectTypeOf([Pause]).toExtend<Entities>();
	});

	it("takes an EntitySchema mapping a class", () => {
		expectTypeOf([PAUSE]).toExtend<Entities>();
	});

	it("takes both together", () => {
		expectTypeOf([Pause, PAUSE]).toExtend<Entities>();
	});

	it("refuses a file glob", () => {
		expectTypeOf(["src/**/*.entity.ts"]).not.toExtend<Entities>();
	});
});
