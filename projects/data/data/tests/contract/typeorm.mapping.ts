import { EntitySchema } from "typeorm";
import { type Model, SCHEMA } from "./model.js";

const schema = SCHEMA;

/** The TypeORM mapping of one copy of the model. */
export function typeOrmEntities({
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
		new EntitySchema<InstanceType<Model["Order"]>>({
			name: "Order",
			target: Order,
			tableName: "orders",
			schema,
			columns: {
				id: { type: "uuid", primary: true },
				customer: { type: "text" },
				note: { type: "text", nullable: true },
				status: { type: "text" },
				placedAt: { type: "timestamptz", name: "placed_at", nullable: true },
				version: { type: "int", version: true },
			},
			relations: {
				lines: {
					type: "one-to-many",
					target: "Line",
					inverseSide: "order",
					persistence: false,
				},
				approvals: {
					type: "one-to-many",
					target: "Approval",
					inverseSide: "order",
					persistence: false,
				},
			},
		}),
		new EntitySchema<InstanceType<Model["Line"]>>({
			name: "Line",
			target: Line,
			tableName: "line",
			schema,
			columns: {
				id: { type: "uuid", primary: true },
				sku: { type: "text" },
				quantity: { type: "int" },
			},
			relations: {
				order: {
					type: "many-to-one",
					target: "Order",
					joinColumn: { name: "order_id" },
					nullable: false,
				},
				parts: {
					type: "one-to-many",
					target: "Part",
					inverseSide: "line",
					persistence: false,
				},
			},
		}),
		new EntitySchema<InstanceType<Model["Part"]>>({
			name: "Part",
			target: Part,
			tableName: "part",
			schema,
			columns: { id: { type: "uuid", primary: true }, name: { type: "text" } },
			relations: {
				line: {
					type: "many-to-one",
					target: "Line",
					joinColumn: { name: "line_id" },
					nullable: false,
				},
			},
		}),
		new EntitySchema<InstanceType<Model["Approval"]>>({
			name: "Approval",
			target: Approval,
			tableName: "approval",
			schema,
			columns: { by: { type: "text", primary: true }, note: { type: "text", nullable: true } },
			relations: {
				order: {
					type: "many-to-one",
					target: "Order",
					joinColumn: { name: "order_id" },
					nullable: false,
					primary: true,
				},
			},
		}),
		new EntitySchema<InstanceType<Model["Team"]>>({
			name: "Team",
			target: Team,
			tableName: "team",
			schema,
			columns: { id: { type: "uuid", primary: true }, name: { type: "text" } },
			relations: {
				lead: {
					type: "many-to-one",
					target: "Member",
					joinColumn: { name: "lead_id" },
					nullable: true,
				},
			},
		}),
		new EntitySchema<InstanceType<Model["Member"]>>({
			name: "Member",
			target: Member,
			tableName: "member",
			schema,
			columns: { id: { type: "uuid", primary: true }, name: { type: "text" } },
			relations: {
				team: {
					type: "many-to-one",
					target: "Team",
					joinColumn: { name: "team_id" },
					nullable: false,
				},
			},
		}),
		new EntitySchema<InstanceType<Model["Tag"]>>({
			name: "Tag",
			target: Tag,
			tableName: "tag",
			schema,
			columns: {
				id: { type: "int", primary: true, generated: "increment" },
				label: { type: "text" },
			},
		}),
		new EntitySchema<InstanceType<Model["OutboxMessage"]>>({
			name: "OutboxMessage",
			target: OutboxMessage,
			tableName: "outbox",
			schema,
			columns: {
				id: { type: "uuid", primary: true },
				type: { type: "text" },
				payload: { type: "jsonb" },
			},
		}),
	];
}
