import { Templates } from "../templates/templates.service.js";
import type { WorkspaceChanges } from "../templates/workspace-changes.model.js";
import type { Orm } from "../webapi/database-provider.js";
import { AppSource, type SourceEdit } from "./app-source.model.js";
import { type AppTarget, WorkspaceApp } from "./workspace-app.model.js";

const USER_ENTITY: Record<Orm, { name: string; from: string }> = {
	"mikro-orm": { name: "UserEntityMapping", from: "./mappings/user.mapping.js" },
	typeorm: { name: "UserEntity", from: "./entities/user.entity.js" },
};

function edits(orm: Orm): SourceEdit[] {
	const entity = USER_ENTITY[orm];
	return [
		{
			imports: [
				'import { defineAbilitiesFor, mapPrincipal } from "./auth/ability.factory.js";',
			],
			isDone: (source) => source.includes("principalMapper: mapPrincipal"),
			apply: AppSource.replace(
				/\.use\(auth\(\)\)/,
				".use(auth(defineAbilitiesFor, { principalMapper: mapPrincipal }))",
			),
			byHand: [
				"and replace .use(auth()) with .use(auth(defineAbilitiesFor, { principalMapper: mapPrincipal }))",
			],
		},
		{
			imports: [`import { ${entity.name} } from "${entity.from}";`],
			isDone: (source) => new RegExp(`entities: \\[[^\\]]*\\b${entity.name}\\b`).test(source),
			apply: AppSource.replace(/entities: \[/, `entities: [${entity.name}, `),
			byHand: [`and add ${entity.name} to the data provider's entities`],
		},
		{
			imports: ['import { UserEntityRepository } from "./repositories/user.repository.js";'],
			isDone: (source) => /repositories: \[[^\]]*\bUserEntityRepository\b/.test(source),
			apply: AppSource.replace(/repositories: \[/, "repositories: [UserEntityRepository, "),
			byHand: ["and add UserEntityRepository to the data provider's repositories"],
		},
		{
			imports: ['import { seedAdmin } from "./seed.js";'],
			isDone: (source) => source.includes("seed: seedAdmin"),
			apply: AppSource.insertAfter(/^[ \t]*migrations,[ \t]*$/, "seed: seedAdmin,"),
			byHand: ["and add seed: seedAdmin to the data provider's options"],
		},
		{
			imports: ['import { UserService } from "./services/user.service.js";'],
			isDone: (source) => source.includes("registerRequestScoped(UserService)"),
			apply: (source) => {
				const anchor = /^[ \t]*\.withServices\(\((\w+)\) => \{[ \t]*$/m;
				const services = anchor.exec(source)?.[1];
				if (services == null) {
					return undefined;
				}
				const line = `\t${services}.registerRequestScoped(UserService);`;
				return AppSource.insertAfter(anchor, line)(source);
			},
			byHand: ["and register UserService, request scoped, in .withServices()"],
		},
	];
}

/**
 * `decohere add users`: a local profile for each user Auth0 signs in, made on their first request,
 * and the admin seeded in development. Needs Postgres and Auth0 in the app.
 */
export class UsersStep {
	public constructor(
		private readonly changes: WorkspaceChanges,
		private readonly templates = new Templates(),
	) {}

	/** The apps this step needs Postgres and Auth0 in, with the ORM each maps its tables with. */
	public check(targets: AppTarget[]): Map<string, Orm> {
		const ready = new Map<string, Orm>();
		for (const { name } of targets) {
			const app = new WorkspaceApp(this.changes, name);
			const orm = app.orm;
			if (orm == null || !app.hasAuth) {
				this.changes.tellByHand(`projects/${name}/src/app.ts`, [
					"Local users need Postgres and Auth0 first: decohere add postgres, then decohere add auth0.",
				]);
				continue;
			}
			ready.set(name, orm);
		}
		return ready;
	}

	public apply(workspace: string, targets: AppTarget[], env: Record<string, string>): void {
		const ready = this.check(targets);
		if (Object.keys(env).length > 0) {
			this.changes.setEnv(env);
		}
		for (const { name, port } of targets) {
			const orm = ready.get(name);
			if (orm == null) {
				continue;
			}
			const app = new WorkspaceApp(this.changes, name);
			const names = { workspace, app: name, port };
			this.templates.apply(this.changes, "steps/users", names, { replaces: ["steps/auth0"] });
			this.templates.apply(this.changes, `steps/users-${orm}`, names);
			app.writeMigrationIndex();
			app.source.edit(edits(orm));
		}
	}
}
