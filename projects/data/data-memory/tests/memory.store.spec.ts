// What the memory store does that the shared contract cases can't show: the database's own rules
// (foreign keys, row locks, deadlocks, SQL's nulls) and rows copied in and out.
import { OptimisticLockError, TrackingUnitOfWork } from "@decohere/data";
import { describe, expect, it } from "vitest";
import { MemoryRowStore, MemoryStore } from "../src/index.js";
import { Book, book, entities, Shelf, shelf } from "./model.js";

function open() {
	const store = new MemoryStore(entities);
	return () => new TrackingUnitOfWork(new MemoryRowStore(store));
}

async function seeded() {
	const begin = open();
	await using uow = begin();
	const s = shelf("s1", "fiction");
	s.books.add(book("b1", "Dune", s, { rating: 5, meta: { tags: ["sand"] } }));
	s.books.add(book("b2", "Emma", s));
	uow.add(s);
	await uow.commit();
	return begin;
}

/** Settles every pending promise callback, so a waiting unit of work shows it is still waiting. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("memory store", () => {
	it("refuses to delete a row another row still references, and keeps both", async () => {
		const begin = await seeded();
		{
			await using uow = begin();
			uow.remove(await uow.findById(Shelf, "s1"));
			await expect(uow.commit()).rejects.toThrow(
				"Can't delete Shelf s1: Book.shelf still references it",
			);
		}
		await using uow = begin();
		expect(await uow.findById(Shelf, "s1", ["books"])).toMatchObject({ label: "fiction" });
		expect(await uow.find(Book)).toHaveLength(2);
	});

	it("refuses a reference to a row that doesn't exist, or none where one is required", async () => {
		// The unit of work inserts what an entity references, so this goes to the rows directly.
		const rows = new MemoryRowStore(new MemoryStore(entities));
		await expect(
			rows.insert(Book, [{ id: "b9", title: "Lost", shelf: "nowhere" }]),
		).rejects.toThrow("Book.shelf references Shelf nowhere, which doesn't exist");
		await expect(
			rows.insert(Book, [{ id: "b9", title: "Lost", shelf: null }]),
		).rejects.toThrow("Book.shelf can't be empty");
		expect(await rows.select(Book, {})).toEqual([]);
	});

	it("refuses a second row with the same key", async () => {
		const begin = await seeded();
		await using uow = begin();
		uow.add(shelf("s1", "again"));
		await expect(uow.commit()).rejects.toThrow("Shelf s1 already exists");
	});

	it("stores copies: changing an object after commit, or a loaded one without commit, changes nothing stored", async () => {
		const begin = open();
		const s = shelf("s1", "fiction");
		const meta = { tags: ["sand"] };
		const published = new Date("1965-08-01T00:00:00Z");
		{
			await using uow = begin();
			uow.add(s);
			uow.add(book("b1", "Dune", s, { meta, published }));
			await uow.commit();
		}
		meta.tags.push("worms");
		published.setUTCFullYear(2000);
		{
			await using uow = begin();
			const loaded = await uow.findById(Book, "b1");
			loaded.meta.tags.push("spice");
		}
		await using uow = begin();
		const stored = await uow.findById(Book, "b1");
		expect(stored.meta).toEqual({ tags: ["sand"] });
		expect(stored.published).toEqual(new Date("1965-08-01T00:00:00Z"));
	});

	it("compares and orders empty values as SQL does", async () => {
		const begin = await seeded();
		await using uow = begin();
		expect((await uow.find(Book, { where: { rating: { ne: 4 } } })).map((b) => b.id)).toEqual([
			"b1",
		]);
		expect((await uow.find(Book, { where: { rating: { lt: 9 } } })).map((b) => b.id)).toEqual([
			"b1",
		]);
		const asc = await uow.find(Book, { orderBy: { rating: "asc" } });
		expect(asc.map((b) => b.id)).toEqual(["b1", "b2"]);
		const desc = await uow.find(Book, { orderBy: { rating: "desc" } });
		expect(desc.map((b) => b.id)).toEqual(["b2", "b1"]);
	});

	it('serialises lock: "update" on a row: the second waits for the first to commit, then reads its write', async () => {
		const begin = await seeded();
		await using first = begin();
		await using second = begin();
		const [mine] = await first.find(Shelf, { where: { id: "s1" }, lock: "update" });
		let theirs: Shelf | undefined;
		const waiting = second
			.find(Shelf, { where: { id: "s1" }, lock: "update" })
			.then(([found]) => (theirs = found));
		await settle();
		expect(theirs).toBeUndefined();
		mine.label = "classics";
		await first.commit();
		await waiting;
		expect(theirs).toMatchObject({ label: "classics", version: 2 });
	});

	it("makes two commits updating one row at once take turns: the later one loses on its version", async () => {
		const begin = await seeded();
		await using first = begin();
		await using second = begin();
		(await first.findById(Shelf, "s1")).label = "first";
		(await second.findById(Shelf, "s1")).label = "second";
		const [a, b] = await Promise.allSettled([first.commit(), second.commit()]);
		expect(a.status).toBe("fulfilled");
		expect(b).toMatchObject({ status: "rejected", reason: expect.any(OptimisticLockError) });
		await using check = begin();
		expect(await check.findById(Shelf, "s1")).toMatchObject({ label: "first", version: 2 });
	});

	it("ends a deadlock by failing the unit of work that would wait for itself", async () => {
		const begin = await seeded();
		{
			await using uow = begin();
			uow.add(shelf("s2", "poetry"));
			await uow.commit();
		}
		await using first = begin();
		await using second = begin();
		await first.find(Shelf, { where: { id: "s1" }, lock: "update" });
		await second.find(Shelf, { where: { id: "s2" }, lock: "update" });
		const firstWaits = first.find(Shelf, { where: { id: "s2" }, lock: "update" });
		await settle();
		await expect(second.find(Shelf, { where: { id: "s1" }, lock: "update" })).rejects.toThrow(
			/Deadlock/,
		);
		await second[Symbol.asyncDispose]();
		await expect(firstWaits).resolves.toHaveLength(1);
	});

	it("rejects a query on a property that isn't mapped", async () => {
		const begin = await seeded();
		await using uow = begin();
		await expect(uow.find(Book, { where: { nope: 1 } as never })).rejects.toThrow(
			'Book has no field "nope"',
		);
	});
});
