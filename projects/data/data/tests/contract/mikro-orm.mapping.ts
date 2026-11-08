import { defineEntity, p } from "@mikro-orm/core";
import { type Model, SCHEMA } from "./model.js";

const schema = SCHEMA;

/** The MikroORM mapping of one copy of the model. */
export function mikroOrmEntities({
	Order,
	Line,
	Part,
	Approval,
	Team,
	Member,
	Tag,
	OutboxMessage,
}: Model) {
	const OrderSchema = defineEntity({
		class: Order,
		tableName: "orders",
		schema,
		properties: {
			id: p.uuid().primary(),
			customer: p.text(),
			note: p.text().nullable(),
			status: p.text(),
			placedAt: p.datetime().columnType("timestamptz").fieldName("placed_at").nullable(),
			version: p.integer().version(),
			lines: () =>
				p.oneToMany(LineSchema).mappedBy("order").orphanRemoval().orderBy({ id: "asc" }),
			approvals: () =>
				p.oneToMany(ApprovalSchema).mappedBy("order").orphanRemoval().orderBy({ by: "asc" }),
		},
	});

	const LineSchema = defineEntity({
		class: Line,
		tableName: "line",
		schema,
		properties: {
			id: p.uuid().primary(),
			order: () => p.manyToOne(OrderSchema).fieldName("order_id"),
			sku: p.text(),
			quantity: p.integer(),
			parts: () =>
				p.oneToMany(PartSchema).mappedBy("line").orphanRemoval().orderBy({ id: "asc" }),
		},
	});

	const PartSchema = defineEntity({
		class: Part,
		tableName: "part",
		schema,
		properties: {
			id: p.uuid().primary(),
			line: () => p.manyToOne(LineSchema).fieldName("line_id"),
			name: p.text(),
		},
	});

	const ApprovalSchema = defineEntity({
		class: Approval,
		tableName: "approval",
		schema,
		properties: {
			order: () => p.manyToOne(OrderSchema).fieldName("order_id").primary(),
			by: p.text().primary(),
			note: p.text().nullable(),
		},
	});

	const TeamSchema = defineEntity({
		class: Team,
		tableName: "team",
		schema,
		properties: {
			id: p.uuid().primary(),
			name: p.text(),
			lead: () => p.manyToOne(MemberSchema).fieldName("lead_id").nullable(),
		},
	});

	const MemberSchema = defineEntity({
		class: Member,
		tableName: "member",
		schema,
		properties: {
			id: p.uuid().primary(),
			name: p.text(),
			team: () => p.manyToOne(TeamSchema).fieldName("team_id"),
		},
	});

	const TagSchema = defineEntity({
		class: Tag,
		tableName: "tag",
		schema,
		properties: { id: p.integer().primary().autoincrement(), label: p.text() },
	});

	const OutboxSchema = defineEntity({
		class: OutboxMessage,
		tableName: "outbox",
		schema,
		properties: {
			id: p.uuid().primary(),
			type: p.text(),
			payload: p.json().columnType("jsonb"),
		},
	});

	return [
		OrderSchema,
		LineSchema,
		PartSchema,
		TeamSchema,
		MemberSchema,
		TagSchema,
		OutboxSchema,
	];
}
