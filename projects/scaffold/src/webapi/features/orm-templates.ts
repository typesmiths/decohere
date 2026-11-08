import type { Orm } from "../database-provider.js";

/** One table the scaffold maps: its files, what the app imports, and the migration that creates it. */
export type TableTemplate = {
	files: { filePath: string; content: string }[];
	/** What the provider's `entities` lists: the mapping. */
	entity: { className: string; importPath: string };
	migration: { name: string; up: string[]; down: string[] };
};

// The SQL is each ORM's own `db generate` output for the mapping beside it, so a generated app
// finds nothing to generate until its mappings change. tests/first-migrations.docker.spec.ts checks it.

const SAMPLE_ENTITY_CLASS_TS = `export class SampleEntity {
\tpublic id!: number;
\tpublic name!: string;
}
`;

const SAMPLE_MAPPING_MIKRO_ORM_TS = `import { defineEntity, p } from "@mikro-orm/core";
import { SampleEntity } from "../entities/sample.entity.js";

export const SampleEntityMapping = defineEntity({
\tclass: SampleEntity,
\ttableName: "sample_entity",
\tproperties: {
\t\tid: p.integer().primary().autoincrement(),
\t\tname: p.string(),
\t},
});
`;

const SAMPLE_ENTITY_TYPEORM_TS = `import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity()
export class SampleEntity {
\t@PrimaryGeneratedColumn()
\tpublic id!: number;

\t@Column()
\tpublic name!: string;
}
`;

const USER_ENTITY_CLASS_TS = `export class UserEntity {
\tpublic id!: number;
\tpublic sub!: string;
\tpublic email!: string | null;
\tpublic displayName!: string;
\t/** App-owned roles. The \`admin\` role grants CASL \`manage\`/\`all\` (wildcard). */
\tpublic roles!: string[];
}
`;

const USER_MAPPING_MIKRO_ORM_TS = `import { defineEntity, p } from "@mikro-orm/core";
import { UserEntity } from "../entities/user.entity.js";

export const UserEntityMapping = defineEntity({
\tclass: UserEntity,
\ttableName: "user_entity",
\tproperties: {
\t\tid: p.integer().primary().autoincrement(),
\t\tsub: p.string().unique(),
\t\temail: p.string().nullable(),
\t\tdisplayName: p.string(),
\t\troles: p.json<string[]>().default("[]"),
\t},
});
`;

const USER_ENTITY_TYPEORM_TS = `import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";

@Entity()
export class UserEntity {
\t@PrimaryGeneratedColumn()
\tpublic id!: number;

\t@Column({ unique: true })
\tpublic sub!: string;

\t@Column({ type: "varchar", nullable: true })
\tpublic email!: string | null;

\t@Column()
\tpublic displayName!: string;

\t/** App-owned roles. The \`admin\` role grants CASL \`manage\`/\`all\` (wildcard). */
\t@Column({ type: "simple-json", default: "[]" })
\tpublic roles!: string[];
}
`;

export function sampleTable(orm: Orm): TableTemplate {
	if (orm === "mikro-orm") {
		return {
			files: [
				{ filePath: "src/entities/sample.entity.ts", content: SAMPLE_ENTITY_CLASS_TS },
				{ filePath: "src/mappings/sample.mapping.ts", content: SAMPLE_MAPPING_MIKRO_ORM_TS },
			],
			entity: { className: "SampleEntityMapping", importPath: "./mappings/sample.mapping.js" },
			migration: {
				name: "create-sample-entity",
				up: [
					'create table "sample_entity" ("id" serial primary key, "name" varchar(255) not null)',
				],
				down: ['drop table if exists "sample_entity" cascade'],
			},
		};
	}
	return {
		files: [{ filePath: "src/entities/sample.entity.ts", content: SAMPLE_ENTITY_TYPEORM_TS }],
		entity: { className: "SampleEntity", importPath: "./entities/sample.entity.js" },
		migration: {
			name: "create-sample-entity",
			up: [
				'CREATE TABLE "sample_entity" ("id" SERIAL NOT NULL, "name" character varying NOT NULL, CONSTRAINT "PK_e873152a04c344da778041e482c" PRIMARY KEY ("id"))',
			],
			down: ['DROP TABLE "sample_entity"'],
		},
	};
}

export function userTable(orm: Orm): TableTemplate {
	if (orm === "mikro-orm") {
		return {
			files: [
				{ filePath: "src/entities/user.entity.ts", content: USER_ENTITY_CLASS_TS },
				{ filePath: "src/mappings/user.mapping.ts", content: USER_MAPPING_MIKRO_ORM_TS },
			],
			entity: { className: "UserEntityMapping", importPath: "./mappings/user.mapping.js" },
			migration: {
				name: "create-user-entity",
				up: [
					`create table "user_entity" ("id" serial primary key, "sub" varchar(255) not null, "email" varchar(255) null, "display_name" varchar(255) not null, "roles" jsonb not null default '[]')`,
					'alter table "user_entity" add constraint "user_entity_sub_unique" unique ("sub")',
				],
				down: ['drop table if exists "user_entity" cascade'],
			},
		};
	}
	return {
		files: [{ filePath: "src/entities/user.entity.ts", content: USER_ENTITY_TYPEORM_TS }],
		entity: { className: "UserEntity", importPath: "./entities/user.entity.js" },
		migration: {
			name: "create-user-entity",
			up: [
				`CREATE TABLE "user_entity" ("id" SERIAL NOT NULL, "sub" character varying NOT NULL, "email" character varying, "displayName" character varying NOT NULL, "roles" text NOT NULL DEFAULT '[]', CONSTRAINT "UQ_9a43efa5912aa6b732b2ea43cf2" UNIQUE ("sub"), CONSTRAINT "PK_b54f8ea623b17094db7667d8206" PRIMARY KEY ("id"))`,
			],
			down: ['DROP TABLE "user_entity"'],
		},
	};
}

/** The seed that creates the Auth0 admin's local profile, in the provider's own API. */
export function adminSeed(orm: Orm): string {
	const fields = [
		"user.sub = sub;",
		"user.email = process.env.AUTH0_ADMIN_USER_EMAIL ?? null;",
		'user.displayName = process.env.AUTH0_ADMIN_USERNAME ?? "admin";',
		'user.roles = ["admin"];',
	];
	if (orm === "mikro-orm") {
		return [
			"const sub = process.env.AUTH0_ADMIN_USER_SUB;",
			"if (!sub) return;",
			"const em = orm.em.fork();",
			"if (await em.findOne(UserEntity, { sub })) return;",
			"const user = new UserEntity();",
			...fields,
			"await em.persist(user).flush();",
		].join(" ");
	}
	return [
		"const sub = process.env.AUTH0_ADMIN_USER_SUB;",
		"if (!sub) return;",
		"const repo = dataSource.getRepository(UserEntity);",
		"if (await repo.findOne({ where: { sub } })) return;",
		"const user = new UserEntity();",
		...fields,
		"await repo.save(user);",
	].join(" ");
}
