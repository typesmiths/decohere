// An app on the memory provider, as a developer composes it: repositories over the unit of work,
// with no database and no database config.
import "reflect-metadata";
import { Builder } from "@decohere/core/hosting";
import { ServiceContainerBuilder } from "@decohere/crucible";
import { injectable } from "@decohere/crucible/decorators";
import {
	DataConfigurationError,
	DEFAULT_DATA_SOURCE,
	type EntityMapping,
	type EntityModel,
	type IUnitOfWork,
	injectUnitOfWork,
	Repository,
} from "@decohere/data";
import { describe, expect, it } from "vitest";
import { mapEntity, memory, type MemoryModuleConfig } from "../src/index.js";
import { Book, book, entities, Shelf, shelf } from "./model.js";

@injectable()
class ShelfRepository extends Repository<Shelf> {
	public constructor(@injectUnitOfWork() unitOfWork: IUnitOfWork) {
		super(unitOfWork, Shelf);
	}
}

/** Another provider's mapping, as memory() sees it: models read when the app is built. */
class ReadMapping implements EntityMapping {
	public constructor(private readonly read: EntityModel[]) {}

	public async models(): Promise<EntityModel[]> {
		return this.read;
	}
}

function build(config: Partial<MemoryModuleConfig> = {}) {
	return Builder.create(new ServiceContainerBuilder())
		.use(memory({ entities, repositories: [ShelfRepository], ...config }))
		.build();
}

async function start(config: Partial<MemoryModuleConfig> = {}) {
	const app = await build(config);
	await app.start({ port: 0, shutdownSignals: false, startRetry: false });
	return app;
}

describe("memory()", () => {
	it("gives each request a unit of work, and what one request commits the next one reads", async () => {
		await using app = await start();
		{
			await using scope = app.services.beginScope("a request");
			const shelves = scope.resolve(ShelfRepository);
			const s = shelf("s1", "fiction");
			s.books.add(book("b1", "Dune", s));
			shelves.add(s);
			await scope.resolve<IUnitOfWork>(DEFAULT_DATA_SOURCE).commit();
		}
		await using scope = app.services.beginScope("a later request");
		const found = await scope.resolve(ShelfRepository).findById("s1", ["books"]);
		expect([...found.books].map((b) => b.title)).toEqual(["Dune"]);
	});

	it("gives each app its own rows", async () => {
		await using first = await start();
		await using second = await start();
		{
			await using scope = first.services.beginScope("a request");
			const uow = scope.resolve<IUnitOfWork>(DEFAULT_DATA_SOURCE);
			uow.add(shelf("s1", "fiction"));
			await uow.commit();
		}
		await using scope = second.services.beginScope("a request");
		expect(await scope.resolve(ShelfRepository).find()).toEqual([]);
	});

	it("seeds when the app starts, not when it is built", async () => {
		const seed = async (uow: IUnitOfWork) => uow.add(shelf("s1", "seeded"));
		await using app = await build({ seed });
		const read = async () => {
			await using scope = app.services.beginScope("a request");
			return scope.resolve(ShelfRepository).find();
		};
		expect(await read()).toEqual([]);
		await app.start({ port: 0, shutdownSignals: false, startRetry: false });
		expect((await read()).map((s) => s.label)).toEqual(["seeded"]);
	});

	it("fails the build when a mapping points at a class that isn't mapped", async () => {
		await expect(build({ entities: [entities[0]] })).rejects.toThrow(
			"Shelf.books points at Book, which isn't mapped: add it to entities",
		);
		await expect(
			build({
				entities: [
					entities[0],
					mapEntity(Book, {
						fields: ["title"],
						references: [{ prop: "shelf", target: Book }],
					}),
				],
			}),
		).rejects.toThrow("Shelf.books: Book.shelf must be a reference to Shelf");
	});

	it("takes another provider's mapping in place of mapEntity", async () => {
		await using app = await start({ entities: new ReadMapping(entities) });
		{
			await using scope = app.services.beginScope("a request");
			const s = shelf("s1", "fiction");
			s.books.add(book("b1", "Dune", s));
			scope.resolve(ShelfRepository).add(s);
			await scope.resolve<IUnitOfWork>(DEFAULT_DATA_SOURCE).commit();
		}
		await using scope = app.services.beginScope("a later request");
		const found = await scope.resolve(ShelfRepository).findById("s1", ["books"]);
		expect([...found.books].map((b) => b.title)).toEqual(["Dune"]);
	});

	it("fails the build when another provider's mapping doesn't fit", async () => {
		await expect(build({ entities: new ReadMapping([entities[0]]) })).rejects.toThrow(
			"Shelf.books points at Book, which isn't mapped: add it to entities",
		);
	});

	it("needs a name for each data source when there are several", () => {
		expect(() => memory([{ entities }, { name: "audit", entities }])).toThrow(
			DataConfigurationError,
		);
	});
});
