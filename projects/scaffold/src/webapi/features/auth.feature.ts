import { join } from "node:path";
import { ask, pick } from "../../domain/prompt.js";
import type { ConfigYaml } from "../../models/config-yaml.model.js";
import { WELL_KNOWN_FILES } from "../../models/const.js";
import type { EnvFile } from "../../models/env-file.model.js";
import type { WorkspaceScaffold } from "../../models/project.model.js";
import type { Feature } from "../../services/scaffold.service.js";
import {
	ensureLoggedIn,
	ensureLoginApp,
	ensureTokenApp,
	readEnvFile,
} from "../auth0-commands.js";
import { AUTH_CONFIG_SECTION, AuthConfigModel } from "../models/auth-config.model.js";
import { ControllerSourceFile } from "../models/controller-source-file.model.js";
import { type DatabaseProvider, type Orm, ormOf } from "../database-provider.js";
import type { HelloSpecFile } from "../models/hello-spec-file.model.js";
import type { MainSourceFile } from "../models/main-source-file.model.js";
import { MigrationsModel } from "../models/migrations.model.js";
import { adminSeed, userTable } from "./orm-templates.js";
import * as auth0Cli from "./auth0-cli.js";

export type AuthOptions = {
	authProvider?: "auth0" | "none";
	issuerBaseUrl?: string;
	audience?: string;
	/** Set by the questions. Nothing changes on Auth0 until they're all answered. */
	auth0ApiAction?: "create" | "update";
	databaseProvider?: DatabaseProvider;
	adminUsername?: string;
	adminPassword?: string;
};

const ADMIN_ROLE = "admin";

const USER_REPOSITORY_TS = `import { injectable } from "@decohere/crucible/decorators";
import { injectUnitOfWork, type IUnitOfWork, Repository } from "@decohere/data";
import { UserEntity } from "../entities/user.entity.js";

@injectable()
export class UserEntityRepository extends Repository<UserEntity> {
\tpublic constructor(@injectUnitOfWork() unitOfWork: IUnitOfWork) {
\t\tsuper(unitOfWork, UserEntity);
\t}

\tpublic findBySub(sub: string): Promise<UserEntity | null> {
\t\treturn this.findOne({ where: { sub } });
\t}
}
`;

const USER_SERVICE_TS = `import { injectable } from "@decohere/crucible/decorators";
import { injectUnitOfWork, type IUnitOfWork } from "@decohere/data";
import type { Principal } from "@decohere/http";
import { UserEntity } from "../entities/user.entity.js";
import { UserEntityRepository } from "../repositories/user.repository.js";

function claimString(principal: Principal | undefined, key: string): string | undefined {
\tconst value = principal?.[key];
\treturn typeof value === "string" && value.length > 0 ? value : undefined;
}

@injectable()
export class UserService {
\tpublic constructor(
\t\tprivate readonly users: UserEntityRepository,
\t\t@injectUnitOfWork() private readonly unitOfWork: IUnitOfWork,
\t) {}

\t/**
\t * Upsert a local profile keyed by JWT \`sub\`.
\t * Profile fields from the token fill gaps; seeded rows keep displayName/email/roles.
\t */
\tpublic async ensureFromPrincipal(principal: Principal | undefined): Promise<UserEntity> {
\t\tconst sub = principal?.sub;
\t\tif (!sub) {
\t\t\tthrow new Error("Authenticated request is missing principal.sub");
\t\t}

\t\tconst email =
\t\t\tclaimString(principal, "email") ?? claimString(principal, "preferred_username");
\t\tconst displayFromToken =
\t\t\tclaimString(principal, "name") ??
\t\t\tclaimString(principal, "nickname") ??
\t\t\temail;

\t\tconst existing = await this.users.findBySub(sub);
\t\tif (existing) {
\t\t\tif (!existing.email && email) existing.email = email;
\t\t\tif (existing.displayName === existing.sub && displayFromToken) {
\t\t\t\texisting.displayName = displayFromToken;
\t\t\t}
\t\t\t// Writes only what changed, if anything did.
\t\t\tawait this.unitOfWork.commit();
\t\t\treturn existing;
\t\t}

\t\tconst created = new UserEntity();
\t\tcreated.sub = sub;
\t\tcreated.email = email ?? null;
\t\tcreated.displayName = displayFromToken ?? sub;
\t\tcreated.roles = Array.isArray(principal.roles)
\t\t\t? principal.roles.filter((r): r is string => typeof r === "string")
\t\t\t: [];
\t\tthis.users.add(created);
\t\tawait this.unitOfWork.commit();
\t\treturn created;
\t}
}
`;

const ABILITY_FACTORY_TS = `import type { Principal } from "@decohere/http";
import {
\tADMIN_ROLE,
\tcreatePrincipalFromPayload,
\tdefineAbilitiesFor as defaultDefineAbilitiesFor,
} from "@decohere/http";

/**
 * Customize CASL authorization here (product-specific rules).
 *
 * Default delegates to \`@decohere/http\`: \`admin\` role → \`manage\`/\`all\`; IdP scopes
 * (\`action:Subject\`) → abilities. Replace the body when you need app rules
 * beyond that — this file is the intentional extension point, not framework
 * infrastructure to copy.
 */
export function defineAbilitiesFor(principal: Principal) {
\treturn defaultDefineAbilitiesFor(principal);
}

/**
 * Customize JWT → Principal mapping here (IdP-specific claims).
 *
 * Elevates \`AUTH0_ADMIN_USER_SUB\` to the admin role so the seeded admin works
 * before/without roles on the access token.
 */
export function mapPrincipal(payload: Record<string, unknown>): Principal {
\tconst principal = createPrincipalFromPayload(payload);
\tconst sub = principal.sub;
\tif (sub && sub === process.env.AUTH0_ADMIN_USER_SUB) {
\t\treturn {
\t\t\t...principal,
\t\t\troles: [...new Set([ADMIN_ROLE, ...(principal.roles ?? [])])],
\t\t};
\t}
\treturn principal;
}
`;

async function getOptions(
	workspace: WorkspaceScaffold,
	cliOptions: Partial<AuthOptions>,
): Promise<Partial<AuthOptions>> {
	if (cliOptions.authProvider === "auth0" && !cliOptions.issuerBaseUrl) {
		return getAuth0Options(workspace, cliOptions);
	}
	if (cliOptions.authProvider != null) return {};

	const choices = [{ label: "none" as const }, { label: "auth0" as const }];
	const selected = await pick("\n  Auth provider: ", choices, (c) => c.label);
	const provider = selected?.label ?? "none";

	if (provider !== "auth0") return { authProvider: "none" };

	return getAuth0Options(workspace, cliOptions);
}

async function getAuth0Options(
	workspace: WorkspaceScaffold,
	cliOptions: Partial<AuthOptions>,
): Promise<Partial<AuthOptions>> {
	const active = ensureLoggedIn();
	const issuerBaseUrl = `https://${active.name}`;
	console.log(`\n  ✓ Auth0 tenant: ${issuerBaseUrl}`);

	process.stdout.write("\n  Fetching Auth0 APIs...");
	const userApis = auth0Cli.listApis().filter((a) => !a.name.includes("Management API"));
	process.stdout.write(` found ${userApis.length}.\n`);

	type ApiChoice = { label: string; existing: string | null };
	const projectName = workspace.name;
	const apiChoices: ApiChoice[] = [
		{ label: `<new> https://api.${projectName}`, existing: null },
		...userApis.map((a) => ({ label: `${a.name} — ${a.identifier}`, existing: a.identifier })),
	];

	const apiSelected = await pick("\n  Select Auth0 API: ", apiChoices, (c) => c.label);

	let audience: string;
	let auth0ApiAction: AuthOptions["auth0ApiAction"];
	if (!apiSelected || apiSelected.existing === null) {
		const defaultId = `https://api.${projectName}`;
		audience = await ask(`  API Identifier [${defaultId}]: `, defaultId);
		auth0ApiAction = "create";
	} else {
		audience = apiSelected.existing;
		auth0ApiAction = "update";
		console.log(`  \u2713 Selected: ${audience}`);
	}

	const withLocalUsers = ormOf(cliOptions.databaseProvider) != null;
	let adminUsername: string | undefined;
	let adminPassword: string | undefined;
	if (withLocalUsers) {
		adminUsername =
			cliOptions.adminUsername ?? (await ask("\n  Admin username [admin]: ", "admin"));
		adminPassword = cliOptions.adminPassword;
	}

	return {
		authProvider: "auth0",
		issuerBaseUrl,
		audience,
		auth0ApiAction,
		...(withLocalUsers ? { adminUsername, adminPassword } : {}),
	};
}

function adminEmail(workspaceName: string, username: string): string {
	if (username.includes("@")) return username;
	const slug = workspaceName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
	return `${username}@${slug}.example.com`;
}

function createAuth0AdminUser(
	workspace: WorkspaceScaffold,
	options: AuthOptions,
	authConfig: AuthConfigModel,
): void {
	const username = options.adminUsername ?? "admin";
	// The launcher generates this and saves it after a successful run. It's never written here.
	const password = options.adminPassword ?? process.env.DECOHERE_ADMIN_PASSWORD;
	if (!password) {
		console.log("  No admin password was provided, so no Auth0 admin user was created.");
		return;
	}

	const email = adminEmail(workspace.name, username);
	try {
		const admin = auth0Cli.createAdminDatabaseUser({ email, password, username });
		authConfig.setAdminUser({
			sub: admin.user_id,
			email: admin.email,
			username: admin.username,
		});
		workspace
			.getModel<EnvFile>(WELL_KNOWN_FILES.ENV_FILE)
			?.addEntry("AUTH0_ADMIN_USER_SUB", admin.user_id)
			.addEntry("AUTH0_ADMIN_USER_EMAIL", admin.email)
			.addEntry("AUTH0_ADMIN_USERNAME", admin.username);
		console.log(`  ✓ Auth0 admin user ready: ${admin.email} (role: ${ADMIN_ROLE})`);
		console.log(`    Login with EMAIL (not username): ${admin.email}`);
	} catch (err) {
		console.error(
			`  ✗ Failed to ensure Auth0 admin user (${email}): ${err instanceof Error ? err.message : err}`,
		);
	}
}

function scaffoldLocalUserProfile(workspace: WorkspaceScaffold, orm: Orm): void {
	const user = userTable(orm);
	for (const project of workspace.getProjects()) {
		project
			.getModel<MainSourceFile>(WELL_KNOWN_FILES.MAIN_TS)
			?.addEntity(user.entity)
			.addRepository({
				className: "UserEntityRepository",
				importPath: "./repositories/user.repository.js",
			})
			.addService({
				className: "UserService",
				importPath: "./services/user.service.js",
				scope: "request",
			})
			.addImport("defineAbilitiesFor", "./auth/ability.factory.js")
			.addImport("mapPrincipal", "./auth/ability.factory.js")
			.setSeed(adminSeed(orm));
		if (orm === "mikro-orm") {
			// The seed creates a UserEntity; the provider is given its mapping.
			project
				.getModel<MainSourceFile>(WELL_KNOWN_FILES.MAIN_TS)
				?.addImport("UserEntity", "./entities/user.entity.js");
		}
		project
			.getModel<HelloSpecFile>(WELL_KNOWN_FILES.HELLO_SPEC)
			?.addImport("UserService", "../src/services/user.service.js")
			.addService(
				"// GET /hello reads no users: a stand-in, so the test needs no database.",
				"services.registerSingleton(UserService, {",
				'\tensureFromPrincipal: () => Promise.reject(new Error("No database in this test")),',
				"});",
			);
		(
			project.getModel<MigrationsModel>(WELL_KNOWN_FILES.MIGRATIONS) ??
			project.addModel(new MigrationsModel())
		).add(user.migration.name, user.migration.up, user.migration.down);

		project.addFile({
			files: () => [
				...user.files,
				{ filePath: "src/repositories/user.repository.ts", content: USER_REPOSITORY_TS },
				{ filePath: "src/services/user.service.ts", content: USER_SERVICE_TS },
				{ filePath: "src/auth/ability.factory.ts", content: ABILITY_FACTORY_TS },
			],
		});
	}

	for (const controller of workspace.getModels(ControllerSourceFile)) {
		controller
			.addImport("UserService", "../services/user.service.js")
			.addImport("inject", "@decohere/crucible/decorators")
			.addConstructorParam("@inject(UserService) private readonly users: UserService");
		controller
			.getMethod("getOne")
			.setAsync(true)
			.setBody([
				"const user = await this.users.ensureFromPrincipal(this.principalProvider.currentPrincipal);",
				"return { id, message: `Hello ${user.displayName}!`, username: user.displayName };",
			]);
	}
}

/**
 * The login app's client id. If Auth0 fails, keeps the id from an earlier run. Otherwise it
 * fails, so a project is never left with no way to get a token.
 */
function resolveLoginClientId(workspace: WorkspaceScaffold): string {
	try {
		return ensureLoginApp(workspace.name, workspace.getProjects().length);
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		const existing = readEnvFile(join(workspace.targetDir, ".env")).AUTH0_CLIENT_ID?.trim();
		if (existing) {
			console.error(`  ✗ Failed to ensure the Auth0 login app (${detail})`);
			console.log(`  ✓ Keeping AUTH0_CLIENT_ID from .env (${existing})`);
			return existing;
		}
		// Application-limit messages already say what to do.
		if (auth0Cli.isAuth0EntityLimitError(err)) throw new Error(detail);
		throw new Error(`Failed to create the Auth0 login app: ${detail}`);
	}
}

/** Make the change on Auth0 that the questions chose. Returns the API's identifier. */
function applyAuth0ApiChoice(
	workspace: WorkspaceScaffold,
	action: AuthOptions["auth0ApiAction"],
	audience: string | undefined,
): string | undefined {
	if (audience == null) return audience;
	if (action === "create") {
		console.log("\n  Creating Auth0 API...");
		const { identifier } = auth0Cli.createApi(`${workspace.name} API`, audience);
		console.log(`  \u2713 API created: ${identifier}`);
		return identifier;
	}
	if (action === "update") {
		try {
			auth0Cli.updateApiScopes(audience);
			console.log(`  \u2713 API scopes ensured (${auth0Cli.HELLO_API_SCOPES.join(", ")})`);
		} catch {
			console.error(
				"  ✗ Failed to update API scopes — add Hello scopes in the Auth0 dashboard.",
			);
		}
	}
	return audience;
}

function scaffold(workspace: WorkspaceScaffold, chosen: AuthOptions): void {
	if (chosen.authProvider !== "auth0") return;
	const options: AuthOptions = {
		...chosen,
		audience: applyAuth0ApiChoice(workspace, chosen.auth0ApiAction, chosen.audience),
	};

	const resource = "Hello";
	const orm = ormOf(options.databaseProvider);
	const withLocalUsers = orm != null;

	for (const controller of workspace.getModels(ControllerSourceFile)) {
		controller
			.addDecorator(`@Authorize("read", "${resource}")`)
			.addCortexImport("AllowAnonymous")
			.addCortexImport("Authorize")
			.addCortexImport("IPrincipalProviderToken")
			.addCortexImport("IPrincipalProvider", true)
			.addImport("inject", "@decohere/crucible/decorators")
			.addConstructorParam(
				`@inject(IPrincipalProviderToken) private readonly principalProvider: IPrincipalProvider`,
			);
		controller.getMethod("getAll").addDecorator("@AllowAnonymous()");
		if (!withLocalUsers) {
			controller
				.getMethod("getOne")
				.setBody([
					"const principal = this.principalProvider.currentPrincipal;",
					"const username =",
					'\t(typeof principal?.name === "string" && principal.name) ||',
					'\t(typeof principal?.nickname === "string" && principal.nickname) ||',
					'\t(typeof principal?.email === "string" && principal.email) ||',
					'\t(typeof principal?.preferred_username === "string" && principal.preferred_username) ||',
					"\tprincipal?.sub ||",
					'\t"unknown";',
					"return { id, message: `Hello ${username}!`, username };",
				]);
		}
		controller.getMethod("create").addDecorator(`@Authorize("create", "${resource}")`);
		controller.getMethod("update").addDecorator(`@Authorize("update", "${resource}")`);
		controller.getMethod("remove").addDecorator(`@Authorize("delete", "${resource}")`);
	}

	for (const project of workspace.getProjects()) {
		project
			.getModel<MainSourceFile>(WELL_KNOWN_FILES.MAIN_TS)
			?.addImport("auth", "@decohere/http");
		// The spec checks tokens with a secret of its own, so it needs no Auth0 tenant.
		project
			.getModel<HelloSpecFile>(WELL_KNOWN_FILES.HELLO_SPEC)
			?.addImport("auth", "@decohere/http")
			.addPlugin("auth()")
			.stubEnv("AUTH__SECRET", "a-secret-only-this-test-knows")
			.stubEnv("AUTH__AUDIENCE", "hello-test");
	}

	if (withLocalUsers) {
		scaffoldLocalUserProfile(workspace, orm);
		for (const project of workspace.getProjects()) {
			project
				.getModel<MainSourceFile>(WELL_KNOWN_FILES.MAIN_TS)
				?.addBuilderCall(".use(auth(defineAbilitiesFor, { principalMapper: mapPrincipal }))");
		}
	} else {
		for (const project of workspace.getProjects()) {
			project
				.getModel<MainSourceFile>(WELL_KNOWN_FILES.MAIN_TS)
				?.addBuilderCall(".use(auth())");
		}
	}

	workspace
		.getModel<ConfigYaml>(WELL_KNOWN_FILES.CONFIG_YAML)
		?.addSection(AUTH_CONFIG_SECTION);

	workspace
		.getModel<EnvFile>(WELL_KNOWN_FILES.ENV_FILE)
		?.addEntry("AUTH0_ISSUER_BASE_URL", options.issuerBaseUrl ?? "")
		.addEntry("AUTH0_AUDIENCE", options.audience ?? "");

	const clientId = options.issuerBaseUrl ? resolveLoginClientId(workspace) : undefined;
	if (clientId) {
		workspace
			.getModel<EnvFile>(WELL_KNOWN_FILES.ENV_FILE)
			?.addEntry("AUTH0_CLIENT_ID", clientId);
	}

	if (options.issuerBaseUrl && options.audience) {
		workspace
			.getModel<EnvFile>(WELL_KNOWN_FILES.ENV_FILE)
			?.addEntry(
				"AUTH0_TOKEN_CLIENT_ID",
				ensureTokenApp(workspace.name, options.audience, auth0Cli.HELLO_API_SCOPES),
			);
	}

	const authConfig = new AuthConfigModel({
		issuerBaseUrl: options.issuerBaseUrl ?? "",
		audience: options.audience ?? "",
		clientId,
	});
	workspace.addModel(authConfig);

	if (withLocalUsers) {
		createAuth0AdminUser(workspace, options, authConfig);
	}
}

export const AuthFeature: Feature<AuthOptions> = { getOptions, scaffold };
