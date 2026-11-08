// The unit-of-work contract, run on every provider against real Postgres. MikroORM's own unit of
// work is the reference: its writes are snapshotted, so an upgrade that changes them shows here,
// and data's tracker (under TypeORM) must send the same writes. Each case also checks the outcome.
import assert from "node:assert/strict";
import { ServiceContainerBuilder } from "@decohere/crucible";
import { DataError, type IUnitOfWork, OptimisticLockError } from "@decohere/data";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type PostgresContainer,
	startPostgres,
} from "../../data-typeorm/tests/postgres-container.js";
import { DDL, type Order, SCHEMA, TABLES } from "./contract/model.js";
import { type OpenProvider, openMikroOrm, openTypeOrm } from "./contract/providers.js";
import { reads, shapes } from "./contract/sql-shape.js";

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

type Case = {
	name: string;
	seed?: (p: OpenProvider) => Promise<void>;
	/** The steps whose SQL is compared. */
	run: (p: OpenProvider) => Promise<void>;
	/** Checks the outcome in a fresh unit of work; its SQL isn't compared. */
	check?: (p: OpenProvider) => Promise<void>;
};

const cases: Case[] = [
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
			p.take();
			const second = await uow.findById(p.model.Order, A);
			const third = await uow.findOne(p.model.Order, { where: { id: A } });
			expect(second).toBe(first);
			expect(third).toBe(first);
			// findById answers from the identity map; a query by other terms still asks the database.
			expect(reads(p.take())).toBe(1);
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
];

describe("unit of work contract", () => {
	let pg: PostgresContainer;
	let providers: OpenProvider[];

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

	for (const { name, seed, run, check } of cases) {
		it(name, async () => {
			const sent: Record<string, string[]> = {};
			for (const p of providers) {
				await pg.superuser.query(
					`truncate ${TABLES.map((t) => `${SCHEMA}.${t}`).join(", ")} restart identity`,
				);
				if (seed) await seed(p);
				p.take();
				await run(p);
				sent[p.name] = shapes(p.take());
				await check?.(p);
			}
			expect(sent.MikroORM).toMatchSnapshot();
			expect(sent.TypeORM).toEqual(sent.MikroORM);
		});
	}
});
