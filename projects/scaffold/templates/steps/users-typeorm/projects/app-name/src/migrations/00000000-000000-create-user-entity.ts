import { defineMigration } from "@decohere/data";

// TypeORM's own `db generate` output for the entity, so a new app has nothing to generate.
export default defineMigration({
	id: "00000000-000000-create-user-entity",
	async up({ sql }) {
		await sql(
			`CREATE TABLE "user_entity" ("id" SERIAL NOT NULL, "sub" character varying NOT NULL, "email" character varying, "displayName" character varying NOT NULL, "roles" text NOT NULL DEFAULT '[]', CONSTRAINT "UQ_9a43efa5912aa6b732b2ea43cf2" UNIQUE ("sub"), CONSTRAINT "PK_b54f8ea623b17094db7667d8206" PRIMARY KEY ("id"))`,
		);
	},
	async down({ sql }) {
		await sql('DROP TABLE "user_entity"');
	},
});
