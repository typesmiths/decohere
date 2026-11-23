// The unit-of-work contract's cases: what every provider must do, checked by its outcome. Each
// runs on the SQL providers against Postgres, where their writes are compared too
// (unit-of-work.contract.docker.spec.ts), and on the memory provider (unit-of-work.contract.spec.ts).
import assert from "node:assert/strict";
import { ServiceContainerBuilder } from "@decohere/crucible";
import { DataError, type IUnitOfWork, OptimisticLockError } from "@decohere/data";
import { expect } from "vitest";
import type { Order } from "./model.js";
import type { OpenProvider, SqlProvider } from "./providers.js";

const A = "00000000-0000-4000-a000-00000000000a";
const B = "00000000-0000-4000-a000-00000000000b";

/** Order A with two lines (one part each); order B with none. */
async function seedOrders(p: OpenProvider) {
	await using uow = p.begin();
	const a = new p.model.Order("ann");
	a.id = A;
	a.addLine("apple", 1, ["stalk"]);
	a.addLine("pear", 2, ["leaf"]);
	a.approvals.add(new p.model.Approval("ann"));
	a.approvals.add(new p.model.Approval("bob"));
	const b = new p.model.Order("bob");
	b.id = B;
	uow.add(a);
	uow.add(b);
	await uow.commit();
}

const load = (p: OpenProvider, uow: IUnitOfWork, id: string) =>
	uow.findById(p.model.Order, id, ["lines.parts"]);
const skus = (order: Order) => [...order.lines].map((l) => l.sku);

export type Case<P extends OpenProvider = OpenProvider> = {
	name: string;
	seed?: (p: P) => Promise<void>;
	/** The steps whose SQL is compared. */
	run: (p: P) => Promise<void>;
	/** Checks the outcome in a fresh unit of work; its SQL isn't compared. */
	check?: (p: P) => Promise<void>;
	/** On the SQL providers: checks the statements `run` sent. */
	checkSql?: (statements: string[]) => void;
};

const R1 = "00000000-0000-4000-a000-0000000000f1";
const R2 = "00000000-0000-4000-a000-0000000000f2";
const R3 = "00000000-0000-4000-a000-0000000000f3";
const ALPHA = "00000000-0000-4000-a000-0000000000a1";
/** About 4 KB of JSON: the field a listing shouldn't load. */
const DOCUMENT = {
	steps: Array.from({ length: 100 }, (_, i) => ({ step: i, weight: i / 100 })),
};

/** Two algos, alpha with a large document and beta with an empty one. */
async function seedAlgos(p: OpenProvider) {
	await using uow = p.begin();
	const alpha = new p.model.Algo("alpha", DOCUMENT);
	alpha.id = ALPHA;
	uow.add(alpha);
	uow.add(new p.model.Algo("beta", { steps: [] }));
	await uow.commit();
}

/** The cases every provider runs, memory included. */
export const cases: Case[] = [
	{
		name: "one field changed on a loaded aggregate is written on commit, with no save call",
		seed: seedOrders,
		async run(p) {
			await using uow = p.begin();
			const order = await uow.findById(p.model.Order, A);
			order.note = "checked";
			await uow.commit();
			expect(order.version).toBe(2);
		},
		async check(p) {
			await using uow = p.begin();
			expect((await uow.findById(p.model.Order, A)).note).toBe("checked");
		},
	},
	{
		name: "a row loaded twice is one instance, read once",
		seed: seedOrders,
		async run(p) {
			await using uow = p.begin();
			const first = await uow.findById(p.model.Order, A);
			p.reads();
			const second = await uow.findById(p.model.Order, A);
			const third = await uow.findOne(p.model.Order, { where: { id: A } });
			expect(second).toBe(first);
			expect(third).toBe(first);
			// findById answers from the identity map; a query by other terms still asks the database.
			expect(p.reads()).toBe(1);
			await uow.commit();
		},
	},
	{
		name: "a re-query returns the instance already loaded, with its unsaved changes",
		seed: seedOrders,
		async run(p) {
			await using uow = p.begin();
			const order = await uow.findById(p.model.Order, A);
			order.note = "unsaved";
			const [again] = await uow.find(p.model.Order, { where: { customer: "ann" } });
			expect(again).toBe(order);
			expect(again.note).toBe("unsaved");
		},
	},
	{
		name: "several new aggregates and their children go in one commit, parents first",
		seed: seedOrders,
		async run(p) {
			await using uow = p.begin();
			const c = new p.model.Order("cat");
			c.addLine("fig", 1, ["seed", "skin"]);
			const d = new p.model.Order("dan");
			d.addLine("kiwi", 3);
			uow.add(c);
			uow.add(d);
			const a = await load(p, uow, A);
			a.addLine("plum", 4, ["stone"]);
			await uow.commit();
		},
		async check(p) {
			await using uow = p.begin();
			expect(skus(await load(p, uow, A))).toEqual(["apple", "pear", "plum"]);
			expect(
				await uow.find(p.model.Order, { where: { customer: { in: ["cat", "dan"] } } }),
			).toHaveLength(2);
		},
	},
	{
		name: "a child removed from its collection is deleted, and one added is inserted",
		seed: seedOrders,
		async run(p) {
			await using uow = p.begin();
			const a = await load(p, uow, A);
			const pear = [...a.lines].find((l) => l.sku === "pear");
			// A copy: removing from the collection while iterating it would skip items.
			const parts = [...pear.parts];
			for (const part of parts) pear.parts.remove(part);
			a.lines.remove(pear);
			a.addLine("quince", 5);
			await uow.commit();
		},
		async check(p) {
			await using uow = p.begin();
			expect(skus(await load(p, uow, A))).toEqual(["apple", "quince"]);
		},
	},
	{
		name: "children two deep load, change and insert",
		seed: seedOrders,
		async run(p) {
			await using uow = p.begin();
			const a = await load(p, uow, A);
			const [apple] = a.lines;
			const [stalk] = apple.parts;
			stalk.name = "long stalk";
			apple.parts.add(new p.model.Part("pip"));
			await uow.commit();
		},
		async check(p) {
			await using uow = p.begin();
			const [apple] = (await load(p, uow, A)).lines;
			expect([...apple.parts].map((x) => x.name)).toEqual(["long stalk", "pip"]);
		},
	},
	{
		name: "a child keyed by its parent and a column of its own is added, changed and removed",
		seed: seedOrders,
		async run(p) {
			await using uow = p.begin();
			const a = await uow.findById(p.model.Order, A, ["approvals"]);
			const [ann, bob] = a.approvals;
			ann.note = "after lunch";
			a.approvals.remove(bob);
			a.approvals.add(new p.model.Approval("cat"));
			expect(await uow.findById(p.model.Approval, { order: a, by: "ann" })).toBe(ann);
			await uow.commit();
		},
		async check(p) {
			await using uow = p.begin();
			const a = await uow.findById(p.model.Order, A, ["approvals"]);
			expect([...a.approvals].map((x) => [x.by, x.note])).toEqual([
				["ann", "after lunch"],
				["cat", null],
			]);
		},
	},
	{
		name: "a child moved to another parent is updated, not deleted",
		seed: seedOrders,
		async run(p) {
			await using uow = p.begin();
			const [a, b] = await uow.find(p.model.Order, {
				where: { id: { in: [A, B] } },
				orderBy: { id: "asc" },
				include: ["lines"],
			});
			const pear = [...a.lines].find((l) => l.sku === "pear");
			a.lines.remove(pear);
			b.lines.add(pear);
			await uow.commit();
		},
		async check(p) {
			await using uow = p.begin();
			expect(skus(await load(p, uow, A))).toEqual(["apple"]);
			const b = await load(p, uow, B);
			expect(skus(b)).toEqual(["pear"]);
			expect([...[...b.lines][0].parts].map((x) => x.name)).toEqual(["leaf"]);
		},
	},
	{
		name: "removing an aggregate deletes the children it loaded first; the database cascades the rest",
		seed: seedOrders,
		async run(p) {
			await using uow = p.begin();
			uow.remove(await load(p, uow, A));
			await uow.commit();
		},
		async check(p) {
			await using uow = p.begin();
			expect(await uow.findById(p.model.Order, A)).toBeNull();
			expect(await uow.find(p.model.Line, { where: { sku: "apple" } })).toEqual([]);
			// Approvals weren't loaded: the foreign key's ON DELETE CASCADE removed them.
			expect(await uow.find(p.model.Approval)).toEqual([]);
		},
	},
	{
		name: "rows that reference each other are inserted, then the cycle is closed with an update",
		async run(p) {
			await using uow = p.begin();
			const team = new p.model.Team("red");
			const lead = new p.model.Member("rae", team);
			team.lead = lead;
			uow.add(team);
			uow.add(lead);
			await uow.commit();
		},
		async check(p) {
			await using uow = p.begin();
			const [team] = await uow.find(p.model.Team, { where: { name: "red" } });
			const lead = await uow.findOne(p.model.Member, { where: { name: "rae" } });
			expect(team.lead).toBe(lead);
			expect(lead.team).toBe(team);
		},
	},
	{
		name: "a key the database generates is set on the entity after commit",
		async run(p) {
			await using uow = p.begin();
			const tags = [new p.model.Tag("new"), new p.model.Tag("sale")];
			for (const tag of tags) uow.add(tag);
			await uow.commit();
			expect(tags.map((t) => typeof t.id)).toEqual(["number", "number"]);
			expect(await uow.findById(p.model.Tag, tags[1].id)).toBe(tags[1]);
		},
	},
	{
		name: "disposing without a commit keeps nothing",
		seed: seedOrders,
		async run(p) {
			await using uow = p.begin();
			await uow.beginTransaction();
			(await uow.findById(p.model.Order, A)).note = "dropped";
			uow.add(new p.model.Order("eve"));
		},
		async check(p) {
			await using uow = p.begin();
			expect((await uow.findById(p.model.Order, A)).note).toBeNull();
			expect(await uow.find(p.model.Order, { where: { customer: "eve" } })).toEqual([]);
		},
	},
	{
		name: "a commit failing part-way rolls everything back, and the unit of work refuses more",
		seed: seedOrders,
		async run(p) {
			await using uow = p.begin();
			(await uow.findById(p.model.Order, A)).note = "rolled back";
			uow.add(new p.model.Order("fay"));
			const duplicate = new p.model.Order("gus");
			duplicate.id = B;
			uow.add(duplicate);
			await expect(uow.commit()).rejects.toThrow();
			await expect(uow.find(p.model.Order)).rejects.toThrow(DataError);
		},
		async check(p) {
			await using uow = p.begin();
			expect((await uow.findById(p.model.Order, A)).note).toBeNull();
			expect(await uow.find(p.model.Order, { where: { customer: "fay" } })).toEqual([]);
		},
	},
	{
		name: "two units changing one row: the second commit loses",
		seed: seedOrders,
		async run(p) {
			await using first = p.begin();
			await using second = p.begin();
			const mine = await first.findById(p.model.Order, A);
			const theirs = await second.findById(p.model.Order, A);
			mine.note = "first";
			await first.commit();
			theirs.note = "second";
			await expect(second.commit()).rejects.toThrow(OptimisticLockError);
		},
		async check(p) {
			await using uow = p.begin();
			expect((await uow.findById(p.model.Order, A)).note).toBe("first");
		},
	},
	{
		name: "events an aggregate raises are written to the outbox in the same commit",
		seed: seedOrders,
		async run(p) {
			await using uow = p.begin();
			(await uow.findById(p.model.Order, A)).place(new Date("2026-11-08T09:00:00Z"));
			await uow.commit();
		},
		async check(p) {
			await using uow = p.begin();
			const [message] = await uow.find(p.model.OutboxMessage);
			expect(message).toMatchObject({ type: "order.placed", payload: { id: A } });
			expect((await uow.findById(p.model.Order, A)).status).toBe("placed");
		},
	},
	{
		name: "queries filter, order, limit and lock in Decohere's terms",
		seed: seedOrders,
		async run(p) {
			await using uow = p.begin();
			const ordered = await uow.find(p.model.Order, {
				where: { note: null, customer: { ne: "zed" } },
				orderBy: { customer: "desc" },
			});
			expect(ordered.map((o) => o.customer)).toEqual(["bob", "ann"]);
			const big = await uow.find(p.model.Line, { where: { quantity: { gte: 2 } } });
			expect(big.map((l) => l.sku)).toEqual(["pear"]);
			const [first] = await uow.find(p.model.Order, {
				orderBy: { customer: "asc" },
				limit: 1,
				lock: "update",
			});
			expect(first.customer).toBe("ann");
			const a = await uow.findById(p.model.Order, A);
			expect(
				await uow.find(p.model.Line, { where: { order: a }, orderBy: { sku: "asc" } }),
			).toHaveLength(2);
			await uow.commit();
		},
	},
	{
		name: "concurrent requests each get their own unit of work; the one that fails leaves nothing",
		seed: seedOrders,
		async run(p) {
			const builder = new ServiceContainerBuilder();
			const UNIT_OF_WORK = Symbol("UnitOfWork");
			builder.registerRequestScoped(UNIT_OF_WORK, () => p.begin());
			const container = builder.build();
			const request = async (name: string, note: string, fail: boolean) => {
				await using scope = container.beginScope(name);
				const uow = scope.resolve<IUnitOfWork>(UNIT_OF_WORK);
				assert.equal(scope.resolve(UNIT_OF_WORK), uow);
				const order = await uow.findById(p.model.Order, B);
				order.note = note;
				if (!fail) await uow.commit();
				return order;
			};
			const [ok, failed] = await Promise.all([
				request("a", "kept", false),
				request("b", "lost", true),
			]);
			expect(ok).not.toBe(failed);
		},
		async check(p) {
			await using uow = p.begin();
			expect((await uow.findById(p.model.Order, B)).note).toBe("kept");
		},
	},
	{
		name: "an entity added and not yet committed is found by its key, and committed once",
		async run(p) {
			await using uow = p.begin();
			const order = new p.model.Order("ann");
			uow.add(order);
			expect(await uow.findById(p.model.Order, order.id)).toBe(order);
			// "Find it, or add it": found, so not added again.
			if (!(await uow.findById(p.model.Order, order.id))) uow.add(new p.model.Order("ann"));
			await uow.commit();
		},
		async check(p) {
			await using uow = p.begin();
			expect(await uow.find(p.model.Order, { where: { customer: "ann" } })).toHaveLength(1);
		},
	},
	{
		name: "an added entity is found by its key with its children as added, and not after it is removed",
		async run(p) {
			await using uow = p.begin();
			const order = new p.model.Order("ann");
			order.addLine("apple", 1, ["stalk"]);
			uow.add(order);
			const found = await uow.findById(p.model.Order, order.id, ["lines.parts"]);
			expect(found).toBe(order);
			expect(skus(found)).toEqual(["apple"]);
			uow.remove(order);
			expect(await uow.findById(p.model.Order, order.id)).toBeNull();
			await uow.commit();
		},
	},
	{
		name: "a query sees the database: an entity added and not yet committed is in it after commit",
		seed: seedOrders,
		async run(p) {
			await using uow = p.begin();
			const added = new p.model.Order("ann");
			uow.add(added);
			expect(await uow.find(p.model.Order, { where: { customer: "ann" } })).not.toContain(
				added,
			);
			await uow.commit();
			expect(await uow.find(p.model.Order, { where: { customer: "ann" } })).toContain(added);
		},
	},
	{
		name: "addIfAbsent adds an entity unless its key is kept, says which, and the rest of the unit of work still commits",
		seed: seedOrders,
		async run(p) {
			{
				await using first = p.begin();
				const receipt = new p.model.Receipt(R3, 5);
				expect(await first.addIfAbsent(receipt)).toBe(true);
				// Written and managed: found by its key, and a later change is saved on commit.
				expect(await first.findById(p.model.Receipt, R3)).toBe(receipt);
				receipt.memo = "first";
				await first.commit();
			}
			await using second = p.begin();
			const again = new p.model.Receipt(R3, 9);
			expect(await second.addIfAbsent(again)).toBe(false);
			// Not attached: a change to it isn't saved.
			again.memo = "second";
			(await second.findById(p.model.Order, A)).note = "kept";
			await second.commit();
		},
		async check(p) {
			await using uow = p.begin();
			expect(await uow.findById(p.model.Receipt, R3)).toMatchObject({
				amount: 5,
				memo: "first",
			});
			expect((await uow.findById(p.model.Order, A)).note).toBe("kept");
		},
	},
	{
		name: "addIfAbsent takes a whole aggregate: its children are written on commit when it is new, and none when it is kept",
		async run(p) {
			const order = new p.model.Order("ann");
			{
				await using first = p.begin();
				order.addLine("apple", 1, ["stalk"]);
				order.addLine("pear", 2);
				expect(await first.addIfAbsent(order)).toBe(true);
				await first.commit();
			}
			await using second = p.begin();
			const again = new p.model.Order("bob");
			again.id = order.id;
			again.addLine("plum", 3, ["stone"]);
			expect(await second.addIfAbsent(again)).toBe(false);
			await second.commit();
		},
		async check(p) {
			await using uow = p.begin();
			const [order] = await uow.find(p.model.Order, { include: ["lines.parts"] });
			expect(order.customer).toBe("ann");
			expect(skus(order)).toEqual(["apple", "pear"]);
			expect([...order.lines].map((l) => [...l.parts].map((x) => x.name))).toEqual([
				["stalk"],
				[],
			]);
			expect(await uow.find(p.model.Line)).toHaveLength(2);
			expect(await uow.find(p.model.Part)).toHaveLength(1);
		},
	},
	{
		name: "addIfAbsent sets what the database generates, and an aggregate it added takes children and changes on commit",
		async run(p) {
			await using uow = p.begin();
			const tag = new p.model.Tag("new");
			expect(await uow.addIfAbsent(tag)).toBe(true);
			expect(typeof tag.id).toBe("number");
			const order = new p.model.Order("ann");
			expect(await uow.addIfAbsent(order)).toBe(true);
			expect(order.version).toBe(1);
			order.addLine("apple", 1);
			order.note = "added";
			await uow.commit();
			expect(order.version).toBe(2);
			await expect(uow.addIfAbsent(order)).rejects.toThrow(DataError);
		},
		async check(p) {
			await using uow = p.begin();
			const [order] = await uow.find(p.model.Order, { include: ["lines"] });
			expect(order.note).toBe("added");
			expect(skus(order)).toEqual(["apple"]);
			expect(await uow.find(p.model.Tag)).toHaveLength(1);
		},
	},
	{
		name: "a field loaded on request is left out of a listing",
		seed: seedAlgos,
		async run(p) {
			await using uow = p.begin();
			const algos = await uow.find(p.model.Algo, { orderBy: { name: "asc" } });
			expect(algos.map((a) => a.name)).toEqual(["alpha", "beta"]);
			expect(algos.map((a) => a.document)).toEqual([undefined, undefined]);
		},
		checkSql(statements) {
			const reads = statements.filter((s) => /"algo"/.test(s));
			expect(reads).toHaveLength(1);
			expect(reads[0]).not.toMatch(/document/);
		},
	},
	{
		name: "a field loaded on request is kept when an aggregate loaded with it, or without it, changes",
		seed: seedAlgos,
		async run(p) {
			{
				await using uow = p.begin();
				const algo = await uow.findById(p.model.Algo, ALPHA, { load: ["document"] });
				expect(algo.document).toEqual(DOCUMENT);
				algo.name = "alpha 2";
				await uow.commit();
			}
			await using uow = p.begin();
			const algo = await uow.findById(p.model.Algo, ALPHA);
			expect(algo.document).toBeUndefined();
			algo.name = "alpha 3";
			await uow.commit();
		},
		async check(p) {
			await using uow = p.begin();
			const algo = await uow.findById(p.model.Algo, ALPHA, { load: ["document"] });
			expect(algo).toMatchObject({ name: "alpha 3", version: 3, document: DOCUMENT });
		},
	},
	{
		name: "a field loaded on request that wasn't loaded, then assigned, is written on commit",
		seed: seedAlgos,
		async run(p) {
			await using uow = p.begin();
			const algo = await uow.findById(p.model.Algo, ALPHA);
			expect(algo.document).toBeUndefined();
			algo.document = { steps: ["replaced"] };
			await uow.commit();
		},
		async check(p) {
			await using uow = p.begin();
			const algo = await uow.findById(p.model.Algo, ALPHA, { load: ["document"] });
			expect(algo).toMatchObject({ version: 2, document: { steps: ["replaced"] } });
		},
	},
	{
		name: "asking for a field the loaded instance lacks loads it into that instance, by findById or find",
		seed: seedAlgos,
		async run(p) {
			await using uow = p.begin();
			const [alpha, beta] = await uow.find(p.model.Algo, { orderBy: { name: "asc" } });
			expect(await uow.findById(p.model.Algo, ALPHA, { load: ["document"] })).toBe(alpha);
			expect(alpha.document).toEqual(DOCUMENT);
			const again = await uow.find(p.model.Algo, {
				orderBy: { name: "asc" },
				load: ["document"],
			});
			expect(again).toEqual([alpha, beta]);
			expect(again[1]).toBe(beta);
			expect(beta.document).toEqual({ steps: [] });
			// Loaded now: answered from the identity map.
			p.reads();
			expect(await uow.findById(p.model.Algo, ALPHA, { load: ["document"] })).toBe(alpha);
			expect(p.reads()).toBe(0);
			await uow.commit();
		},
	},
];

/** The cases only the SQL providers run: they send SQL of their own, through the provider's `transaction()`. */
export const sqlCases: Case<SqlProvider>[] = [
	{
		name: "a repository's own statement runs in the unit of work's transaction, and rolls back with a failed commit",
		seed: seedOrders,
		async run(p) {
			await using uow = p.begin();
			// No transaction is open yet: the statement must begin it, or it would commit on its own.
			await p.statement(uow, "insert into uow_contract.receipt (id, amount) values (?, ?)", [
				R1,
				5,
			]);
			uow.add(new p.model.Order("fay"));
			const duplicate = new p.model.Order("gus");
			duplicate.id = B;
			uow.add(duplicate);
			await expect(uow.commit()).rejects.toThrow();
		},
		async check(p) {
			await using uow = p.begin();
			expect(await uow.find(p.model.Receipt)).toEqual([]);
			expect(await uow.find(p.model.Order, { where: { customer: "fay" } })).toEqual([]);
		},
	},
	{
		name: "a repository's own statement sees what the unit of work wrote before commit, and others don't",
		async run(p) {
			await using uow = p.begin();
			await p.statement(uow, "insert into uow_contract.receipt (id, amount) values (?, ?)", [
				R2,
				7,
			]);
			const rows = await p.statement(
				uow,
				"select amount from uow_contract.receipt where id = ?",
				[R2],
			);
			expect(rows).toEqual([{ amount: 7 }]);
			await using other = p.begin();
			expect(await other.findById(p.model.Receipt, R2)).toBeNull();
			await uow.commit();
		},
		async check(p) {
			await using uow = p.begin();
			expect((await uow.findById(p.model.Receipt, R2)).amount).toBe(7);
		},
	},
];
