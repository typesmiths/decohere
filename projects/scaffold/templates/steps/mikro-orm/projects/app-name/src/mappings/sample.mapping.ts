import { defineEntity, p } from "@mikro-orm/core";
import { SampleEntity } from "../entities/sample.entity.js";

export const SampleEntityMapping = defineEntity({
	class: SampleEntity,
	tableName: "sample_entity",
	properties: {
		id: p.integer().primary().autoincrement(),
		name: p.string(),
	},
});
