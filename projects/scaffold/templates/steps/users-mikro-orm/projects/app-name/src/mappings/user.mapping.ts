import { defineEntity, p } from "@mikro-orm/core";
import { UserEntity } from "../entities/user.entity.js";

export const UserEntityMapping = defineEntity({
	class: UserEntity,
	tableName: "user_entity",
	properties: {
		id: p.integer().primary().autoincrement(),
		sub: p.string().unique(),
		email: p.string().nullable(),
		displayName: p.string(),
		roles: p.json<string[]>().default("[]"),
	},
});
