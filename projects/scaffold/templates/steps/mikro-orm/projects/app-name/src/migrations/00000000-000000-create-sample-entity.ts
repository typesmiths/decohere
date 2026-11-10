import { defineMigration } from "@decohere/data";

// MikroORM's own `db generate` output for the mapping, so a new app has nothing to generate.
export default defineMigration({
	id: "00000000-000000-create-sample-entity",
	async up({ sql }) {
		await sql(
			'create table "sample_entity" ("id" serial primary key, "name" varchar(255) not null)',
		);
	},
	async down({ sql }) {
		await sql('drop table if exists "sample_entity" cascade');
	},
});
