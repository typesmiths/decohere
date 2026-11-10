import { templates } from "../templates/templates.js";
import type { WorkspaceChanges } from "../templates/workspace-changes.js";
import type { Orm } from "../webapi/database-provider.js";
import { appSource, type SourceEdit } from "./app-source.js";
import { type AppTarget, apps } from "./apps.js";
import { auth0Step } from "./auth0.step.js";
import { migrations } from "./migrations.js";

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
			apply: appSource.replace(
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
			apply: appSource.replace(/entities: \[/, `entities: [${entity.name}, `),
			byHand: [`and add ${entity.name} to the data provider's entities`],
		},
		{
			imports: ['import { UserEntityRepository } from "./repositories/user.repository.js";'],
			isDone: (source) => /repositories: \[[^\]]*\bUserEntityRepository\b/.test(source),
			apply: appSource.replace(/repositories: \[/, "repositories: [UserEntityRepository, "),
			byHand: ["and add UserEntityRepository to the data provider's repositories"],
		},
		{
			imports: ['import { seedAdmin } from "./seed.js";'],
			isDone: (source) => source.includes("seed: seedAdmin"),
			apply: appSource.insertAfter(/^[ \t]*migrations,[ \t]*$/, "seed: seedAdmin,"),
			byHand: ["and add seed: seedAdmin to the data provider's options"],
		},
		{
			imports: ['import { UserService } from "./services/user.service.js";'],
			isDone: (source) => source.includes("registerRequestScoped(UserService)"),
			apply: (source) => {
				const anchor = /^[ \t]*\.withServices\(\((\w+)\) => \{[ \t]*$/m;
				const services = anchor.exec(source)?.[1];
				if (services == null) return undefined;
				const line = `\t${services}.registerRequestScoped(UserService);`;
				return appSource.insertAfter(anchor, line)(source);
			},
			byHand: ["and register UserService, request scoped, in .withServices()"],
		},
	];
}

/** The apps this step needs Postgres and Auth0 in, with the ORM each maps its tables with. */
function check(changes: WorkspaceChanges, targets: AppTarget[]): Map<string, Orm> {
	const ready = new Map<string, Orm>();
	for (const { name: app } of targets) {
		const orm = apps.ormOf(changes, app);
		if (orm == null || !apps.hasAuth(changes, app)) {
			changes.tellByHand(`projects/${app}/src/app.ts`, [
				"Local users need Postgres and Auth0 first: decohere add postgres, then decohere add auth0.",
			]);
			continue;
		}
		ready.set(app, orm);
	}
	return ready;
}

/**
 * `decohere add users`: a local profile for each user Auth0 signs in, made on their first request,
 * and the admin seeded in development. Needs Postgres and Auth0 in the app.
 */
function apply(
	changes: WorkspaceChanges,
	workspace: string,
	targets: AppTarget[],
	env: Record<string, string>,
): void {
	const ready = check(changes, targets);
	if (Object.keys(env).length > 0) {
		changes.write(".env", auth0Step.upsertEnv(changes.read(".env") ?? "", env));
	}
	for (const { name: app, port } of targets) {
		const orm = ready.get(app);
		if (orm == null) continue;
		const names = { workspace, app, port };
		templates.apply(changes, "steps/users", names, { replaces: ["steps/auth0"] });
		templates.apply(changes, `steps/users-${orm}`, names);
		migrations.writeIndex(changes, app);
		appSource.edit(changes, app, edits(orm));
	}
}

export const usersStep = { apply, check };
