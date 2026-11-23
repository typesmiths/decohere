// A small domain for the memory provider's own tests: a shelf of books, each with notes.
import { type Children, ChildList } from "@decohere/data";
import { mapEntity } from "../src/index.js";

export class Shelf {
	public id!: string;
	public label!: string;
	public version!: number;
	public books: Children<Book> = new ChildList();
}

export class Book {
	public id!: string;
	public title!: string;
	public shelf!: Shelf;
	public rating: number | null = null;
	public published: Date | null = null;
	public meta: { tags: string[] } | null = null;
}

export function shelf(id: string, label: string) {
	return Object.assign(new Shelf(), { id, label });
}

export function book(id: string, title: string, s: Shelf, more: Partial<Book> = {}) {
	return Object.assign(new Book(), { id, title, shelf: s, ...more });
}

export const entities = [
	mapEntity(Shelf, {
		fields: ["label"],
		version: "version",
		children: [{ prop: "books", target: Book, parentRef: "shelf" }],
	}),
	mapEntity(Book, {
		fields: ["title", "rating", "published", "meta"],
		references: [{ prop: "shelf", target: Shelf }],
	}),
];
