import { type Children, ChildList, DataConfigurationError } from "@decohere/data";
import { defineEntity, p } from "@mikro-orm/core";
import { describe, expect, it } from "vitest";
import { MikroOrmMapping } from "./mikro-orm-mapping.provider.js";

class Shelf {
	public id!: string;
	public label!: string;
	public version!: number;
	public books: Children<Book> = new ChildList();
}

class Book {
	public id!: string;
	public title!: string;
	public blurb!: string;
	public shelf!: Shelf;
	public sequel!: Book | null;
}

class Label {
	public id!: number;
	public text!: string;
}

const ShelfSchema = defineEntity({
	class: Shelf,
	properties: {
		id: p.uuid().primary(),
		label: p.text(),
		version: p.integer().version(),
		books: () =>
			p.oneToMany(BookSchema).mappedBy("shelf").orphanRemoval().orderBy({ title: "desc" }),
	},
});

const BookSchema = defineEntity({
	class: Book,
	properties: {
		id: p.uuid().primary(),
		title: p.text(),
		blurb: p.text().lazy(),
		shelf: () => p.manyToOne(ShelfSchema).deleteRule("cascade"),
		sequel: () => p.manyToOne(BookSchema).nullable(),
	},
});

const LabelSchema = defineEntity({
	class: Label,
	properties: { id: p.integer().primary().autoincrement(), text: p.text() },
});

describe("MikroOrmMapping", () => {
	it("reads what defineEntity maps as data's models, without a database", async () => {
		const models = await new MikroOrmMapping([ShelfSchema, BookSchema, LabelSchema]).models();
		const byName = Object.fromEntries(models.map((m) => [m.name, m]));

		expect(byName.Shelf).toEqual({
			type: Shelf,
			name: "Shelf",
			key: ["id"],
			fields: ["id", "label", "version"],
			references: [],
			children: [
				{ prop: "books", target: Book, parentRef: "shelf", orderBy: { title: "desc" } },
			],
			version: "version",
			generated: undefined,
			lazy: [],
		});
		expect(byName.Book).toEqual({
			type: Book,
			name: "Book",
			key: ["id"],
			fields: ["id", "title", "blurb"],
			references: [
				{ prop: "shelf", target: Shelf, nullable: false, onDelete: "cascade" },
				{ prop: "sequel", target: Book, nullable: true, onDelete: undefined },
			],
			children: [],
			version: undefined,
			generated: undefined,
			lazy: ["blurb"],
		});
		expect(byName.Label).toMatchObject({ key: ["id"], generated: "id" });
	});

	it("leaves the classes as they are: only a MikroORM instance changes them", async () => {
		await new MikroOrmMapping([ShelfSchema, BookSchema, LabelSchema]).models();

		expect(Object.getOwnPropertyNames(Shelf.prototype)).toEqual(["constructor"]);
		expect(Object.getOwnPropertyNames(Book.prototype)).toEqual(["constructor"]);
	});

	it("follows a change to the mapping, with nothing else to edit", async () => {
		class Pause {
			public code!: string;
			public venue!: string;
		}
		const keyedBy = (key: "code" | "venue") =>
			defineEntity({
				class: Pause,
				properties: {
					code: key === "code" ? p.text().primary() : p.text(),
					venue: key === "venue" ? p.text().primary() : p.text(),
				},
			});

		const [byCode] = await new MikroOrmMapping([keyedBy("code")]).models();
		const [byVenue] = await new MikroOrmMapping([keyedBy("venue")]).models();

		expect(byCode.key).toEqual(["code"]);
		expect(byVenue.key).toEqual(["venue"]);
	});

	it("refuses a many-to-many collection, which the memory provider can't keep", async () => {
		class Tag {
			public id!: string;
		}
		class Post {
			public id!: string;
			public tags!: Tag[];
		}
		const TagSchema = defineEntity({ class: Tag, properties: { id: p.uuid().primary() } });
		const PostSchema = defineEntity({
			class: Post,
			properties: { id: p.uuid().primary(), tags: () => p.manyToMany(TagSchema) },
		});

		await expect(new MikroOrmMapping([PostSchema, TagSchema]).models()).rejects.toThrow(
			new DataConfigurationError("Post.tags: many-to-many relations aren't supported"),
		);
	});
});
