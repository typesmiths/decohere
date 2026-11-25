import "reflect-metadata";
import { type Children, ChildList, DataConfigurationError } from "@decohere/data";
import {
	Column,
	Entity,
	EntitySchema,
	JoinColumn,
	ManyToOne,
	OneToMany,
	PrimaryColumn,
	PrimaryGeneratedColumn,
	VersionColumn,
} from "typeorm";
import { describe, expect, it } from "vitest";
import { TypeOrmMapping } from "./type-orm-mapping.provider.js";

// Mapped as an app maps its domain classes: TypeORM's decorators on the class itself.
@Entity()
class Shelf {
	@PrimaryColumn("uuid")
	public id!: string;
	@Column("text")
	public label!: string;
	@VersionColumn()
	public version!: number;
	@OneToMany(() => Book, (book) => book.shelf, { persistence: false })
	public books: Children<Book> = new ChildList();
}

@Entity()
class Book {
	@PrimaryColumn("uuid")
	public id!: string;
	@Column("text")
	public title!: string;
	@Column({ type: "text", select: false })
	public blurb!: string;
	@ManyToOne(() => Shelf, { nullable: false, onDelete: "CASCADE" })
	@JoinColumn({ name: "shelf_id" })
	public shelf!: Shelf;
	@ManyToOne(() => Book, { nullable: true })
	@JoinColumn({ name: "sequel_id" })
	public sequel!: Book | null;
}

@Entity()
class Label {
	@PrimaryGeneratedColumn()
	public id!: number;
	@Column("text")
	public text!: string;
}

class Pause {
	public code!: string;
	public venue!: string;
	public reason!: string;
}

/** Pause keyed by `key`, as two versions of an app's schema might map it. */
const pauseSchema = (key: "code" | "venue") =>
	new EntitySchema<Pause>({
		name: "Pause",
		target: Pause,
		columns: {
			code: { type: "text", primary: key === "code" },
			venue: { type: "text", primary: key === "venue" },
			reason: { type: "text" },
		},
	});

describe("TypeOrmMapping", () => {
	it("reads classes TypeORM's decorators map as data's models, without a database", async () => {
		const models = await new TypeOrmMapping([Shelf, Book, Label]).models();

		expect(models).toEqual([
			{
				type: Shelf,
				name: "Shelf",
				key: ["id"],
				fields: ["id", "label", "version"],
				references: [],
				children: [{ prop: "books", target: Book, parentRef: "shelf" }],
				version: "version",
				generated: undefined,
				lazy: [],
			},
			{
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
			},
			{
				type: Label,
				name: "Label",
				key: ["id"],
				fields: ["id", "text"],
				references: [],
				children: [],
				version: undefined,
				generated: "id",
				lazy: [],
			},
		]);
	});

	it("follows a change to the mapping, with nothing else to edit", async () => {
		const [byCode] = await new TypeOrmMapping([pauseSchema("code")]).models();
		const [byVenue] = await new TypeOrmMapping([pauseSchema("venue")]).models();

		expect(byCode.key).toEqual(["code"]);
		expect(byVenue.key).toEqual(["venue"]);
	});

	it("keys on a reference whose column is also declared as the primary column", async () => {
		class Order {
			public id!: string;
		}
		class Approval {
			public order!: Order;
			public by!: string;
		}
		const orders = new EntitySchema<Order>({
			name: "Order",
			target: Order,
			columns: { id: { type: "uuid", primary: true } },
		});
		const approvals = new EntitySchema<Approval>({
			name: "Approval",
			target: Approval,
			// TypeORM ignores `primary` on a relation, so the key's column is a column too.
			columns: {
				order: { type: "uuid", primary: true, name: "order_id" },
				by: { type: "text", primary: true },
			},
			relations: {
				order: { type: "many-to-one", target: "Order", joinColumn: { name: "order_id" } },
			},
		});

		const [, approval] = await new TypeOrmMapping([orders, approvals]).models();

		expect(approval.key).toEqual(["order", "by"]);
		expect(approval.fields).toEqual(["by"]);
		expect(approval.references.map((r) => r.prop)).toEqual(["order"]);
	});

	it("refuses a child collection TypeORM would write itself", async () => {
		class Rack {
			public id!: string;
			public slots!: Slot[];
		}
		class Slot {
			public id!: string;
			public rack!: Rack;
		}
		const racks = new EntitySchema<Rack>({
			name: "Rack",
			target: Rack,
			columns: { id: { type: "uuid", primary: true } },
			relations: { slots: { type: "one-to-many", target: "Slot", inverseSide: "rack" } },
		});
		const slots = new EntitySchema<Slot>({
			name: "Slot",
			target: Slot,
			columns: { id: { type: "uuid", primary: true } },
			relations: { rack: { type: "many-to-one", target: "Rack" } },
		});

		await expect(new TypeOrmMapping([racks, slots]).models()).rejects.toThrow(
			new DataConfigurationError(
				"Rack.slots: map child collections with persistence: false; the unit of work writes them",
			),
		);
	});
});
