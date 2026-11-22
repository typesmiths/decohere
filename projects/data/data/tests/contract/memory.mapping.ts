import { mapEntity } from "@decohere/data-memory";
import type { Model } from "./model.js";

/** The memory provider's mapping of one copy of the model: what the DDL says, as data. */
export function memoryEntities({
	Order,
	Line,
	Part,
	Approval,
	Team,
	Member,
	Tag,
	OutboxMessage,
}: Model) {
	return [
		mapEntity(Order, {
			fields: ["customer", "note", "status", "placedAt"],
			version: "version",
			children: [
				{ prop: "lines", target: Line, parentRef: "order" },
				{ prop: "approvals", target: Approval, parentRef: "order" },
			],
		}),
		mapEntity(Line, {
			fields: ["sku", "quantity"],
			references: [{ prop: "order", target: Order }],
			children: [{ prop: "parts", target: Part, parentRef: "line" }],
		}),
		mapEntity(Part, {
			fields: ["name"],
			references: [{ prop: "line", target: Line }],
		}),
		mapEntity(Approval, {
			key: ["order", "by"],
			fields: ["note"],
			references: [{ prop: "order", target: Order, onDelete: "cascade" }],
		}),
		mapEntity(Team, {
			fields: ["name"],
			references: [{ prop: "lead", target: Member, nullable: true }],
		}),
		mapEntity(Member, {
			fields: ["name"],
			references: [{ prop: "team", target: Team }],
		}),
		mapEntity(Tag, { fields: ["label"], generated: "id" }),
		mapEntity(OutboxMessage, { fields: ["type", "payload"] }),
	];
}
