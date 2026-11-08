// The query contract is checked by the compiler: a field, order or include that isn't on the
// entity has no key to match, so a misspelt one fails `pnpm run typecheck`.
import {
	type Children,
	ChildList,
	type EntityKey,
	type Include,
	type OrderBy,
	type Where,
} from "@decohere/data";
import { describe, expectTypeOf, it } from "vitest";

class Part {
	public name = "";
}
class Line {
	public sku = "";
	public quantity = 0;
	public parts: Children<Part> = new ChildList();
	public total() {
		return this.quantity;
	}
}
class Order {
	public id = "";
	public note: string | null = null;
	public placedAt: Date | null = null;
	public lines: Children<Line> = new ChildList();
}

describe("query types", () => {
	it("where and orderBy take the entity's fields, not its children or methods", () => {
		expectTypeOf<keyof Where<Order>>().toEqualTypeOf<"id" | "note" | "placedAt">();
		expectTypeOf<keyof OrderBy<Line>>().toEqualTypeOf<"sku" | "quantity">();
	});

	it("a condition compares with the field's own type", () => {
		expectTypeOf<{ gt: Date }>().toExtend<Where<Order>["placedAt"]>();
		expectTypeOf<{ in: Date[] }>().toExtend<Where<Order>["placedAt"]>();
		expectTypeOf<{ gt: number }>().not.toExtend<Where<Order>["note"]>();
	});

	it("include takes child collections, nested as dotted paths", () => {
		expectTypeOf<Include<Order>>().toEqualTypeOf<"lines" | "lines.parts">();
		expectTypeOf<Include<Part>>().toBeNever();
	});

	it("a key is the entity's fields, or a bare value", () => {
		expectTypeOf<{ id: string }>().toExtend<EntityKey<Order>>();
		expectTypeOf<"order-1">().toExtend<EntityKey<Order>>();
	});
});
