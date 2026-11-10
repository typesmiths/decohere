import { defineMigration } from "@decohere/data";

// MikroORM's own `db generate` output for the mapping, so a new app has nothing to generate.
export default defineMigration({
	id: "00000000-000000-create-user-entity",
	async up({ sql }) {
		await sql(
			`create table "user_entity" ("id" serial primary key, "sub" varchar(255) not null, "email" varchar(255) null, "display_name" varchar(255) not null, "roles" jsonb not null default '[]')`,
		);
		await sql(
			'alter table "user_entity" add constraint "user_entity_sub_unique" unique ("sub")',
		);
	},
	async down({ sql }) {
		await sql('drop table if exists "user_entity" cascade');
	},
});
