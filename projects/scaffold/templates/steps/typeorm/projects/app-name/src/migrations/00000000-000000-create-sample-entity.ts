import { defineMigration } from "@decohere/data";

// TypeORM's own `db generate` output for the entity, so a new app has nothing to generate.
export default defineMigration({
	id: "00000000-000000-create-sample-entity",
	async up({ sql }) {
		await sql(
			'CREATE TABLE "sample_entity" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, CONSTRAINT "PK_e873152a04c344da778041e482c" PRIMARY KEY ("id"))',
		);
	},
	async down({ sql }) {
		await sql('DROP TABLE "sample_entity"');
	},
});
