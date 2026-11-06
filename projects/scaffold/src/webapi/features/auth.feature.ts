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
import type { MainSourceFile } from "../models/main-source-file.model.js";
import * as auth0Cli from "./auth0-cli.js";

export type AuthOptions = {
	authProvider?: "auth0" | "none";
	issuerBaseUrl?: string;
	audience?: string;
	databaseProvider?: "none" | "postgres/typeorm";
	adminUsername?: string;
	adminPassword?: string;
};

const ADMIN_ROLE = "admin";

const USER_ENTITY_TS = `import { Column, Entity, PrimaryGeneratedColumn } from "typeorm";
import type { Entity as IEntity } from "@decohere/data";

@Entity()
export class UserEntity implements IEntity {
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

const USER_REPOSITORY_TS = `import { injectable } from "@decohere/crucible/decorators";
import { injectUnitOfWork } from "@decohere/data";
import { TypeOrmRepository, TypeOrmUnitOfWork } from "@decohere/data-typeorm";
import { UserEntity } from "../entities/user.entity.js";

@injectable()
export class UserEntityRepository extends TypeOrmRepository<UserEntity> {
\tpublic constructor(@injectUnitOfWork() unitOfWork: TypeOrmUnitOfWork) {
\t\tsuper(unitOfWork, UserEntity);
\t}

\tpublic findBySub(sub: string): Promise<UserEntity | null> {
\t\treturn this.firstOrDefault({ where: { sub } });
\t}
}
`;

const USER_SERVICE_TS = `import { injectable } from "@decohere/crucible/decorators";
import type { Principal } from "@decohere/http";
import { UserEntity } from "../entities/user.entity.js";
import { UserEntityRepository } from "../repositories/user.repository.js";

function claimString(principal: Principal | undefined, key: string): string | undefined {
\tconst value = principal?.[key];
\treturn typeof value === "string" && value.length > 0 ? value : undefined;
}

@injectable()
export class UserService {
\tpublic constructor(private readonly users: UserEntityRepository) {}

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
\t\t\tlet dirty = false;
\t\t\tif (!existing.email && email) {
\t\t\t\texisting.email = email;
\t\t\t\tdirty = true;
\t\t\t}
\t\t\tif (existing.displayName === existing.sub && displayFromToken) {
\t\t\t\texisting.displayName = displayFromToken;
\t\t\t\tdirty = true;
\t\t\t}
\t\t\treturn dirty ? this.users.save(existing) : existing;
\t\t}

\t\tconst created = new UserEntity();
\t\tcreated.sub = sub;
\t\tcreated.email = email ?? null;
\t\tcreated.displayName = displayFromToken ?? sub;
\t\tcreated.roles = Array.isArray(principal.roles)
\t\t\t? principal.roles.filter((r): r is string => typeof r === "string")
\t\t\t: [];
\t\treturn this.users.save(created);
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
	if (!apiSelected || apiSelected.existing === null) {
		const defaultId = `https://api.${projectName}`;
		audience = await ask(`  API Identifier [${defaultId}]: `, defaultId);
		console.log("\n  Creating Auth0 API...");
		audience = auth0Cli.createApi(`${projectName} API`, audience).identifier;
		console.log(`  \u2713 API created: ${audience}`);
	} else {
		audience = apiSelected.existing;
		console.log(`  \u2713 Selected: ${audience}`);
		try {
			auth0Cli.updateApiScopes(audience);
			console.log(`  \u2713 API scopes ensured (${auth0Cli.HELLO_API_SCOPES.join(", ")})`);
		} catch {
			console.error(
				"  ✗ Failed to update API scopes — add Hello scopes in the Auth0 dashboard.",
			);
		}
	}

	const withLocalUsers = cliOptions.databaseProvider === "postgres/typeorm";
	let adminUsername: string | undefined;
	let adminPassword: string | undefined;
	if (withLocalUsers) {
		adminUsername =
			cliOptions.adminUsername ?? (await ask("\n  Admin username [admin]: ", "admin"));
		adminPassword = cliOptions.adminPassword;
		if (adminPassword == null) {
			adminPassword = await ask("  Admin password (leave blank to generate): ");
			if (!adminPassword) {
				adminPassword = auth0Cli.generateAdminPassword();
				console.log(`  ✓ Generated admin password (written to .env): ${adminPassword}`);
			}
		}
	}

	return {
		authProvider: "auth0",
		issuerBaseUrl,
		audience,
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
	const password = options.adminPassword;
	if (!password) return;

	const email = adminEmail(workspace.name, username);
	try {
		const admin = auth0Cli.createAdminDatabaseUser({ email, password, username });
		authConfig.setAdminUser({
			sub: admin.user_id,
			email: admin.email,
			password: admin.password,
			username: admin.username,
		});
		workspace
			.getModel<EnvFile>(WELL_KNOWN_FILES.ENV_FILE)
			?.addEntry("AUTH0_ADMIN_USER_SUB", admin.user_id)
			.addEntry("AUTH0_ADMIN_USER_EMAIL", admin.email)
			.addEntry("AUTH0_ADMIN_USER_PASSWORD", admin.password)
			.addEntry("AUTH0_ADMIN_USERNAME", admin.username);
		console.log(`  ✓ Auth0 admin user ready: ${admin.email} (role: ${ADMIN_ROLE})`);
		console.log(`    Login with EMAIL (not username): ${admin.email}`);
		console.log(`    Password: see AUTH0_ADMIN_USER_PASSWORD in .env`);
	} catch (err) {
		console.error(
			`  ✗ Failed to ensure Auth0 admin user (${email}): ${err instanceof Error ? err.message : err}`,
		);
	}
}

function scaffoldLocalUserProfile(workspace: WorkspaceScaffold): void {
	for (const project of workspace.getProjects()) {
		project
			.getModel<MainSourceFile>(WELL_KNOWN_FILES.MAIN_TS)
			?.addEntity({ className: "UserEntity", importPath: "./entities/user.entity.js" })
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
			.setTypeOrmSeed(
				[
					"const sub = process.env.AUTH0_ADMIN_USER_SUB;",
					"if (!sub) return;",
					"const repo = dataSource.getRepository(UserEntity);",
					"const existing = await repo.findOne({ where: { sub } });",
					"if (existing) return;",
					"await repo.save(repo.create({",
					"  sub,",
					"  email: process.env.AUTH0_ADMIN_USER_EMAIL ?? null,",
					'  displayName: process.env.AUTH0_ADMIN_USERNAME ?? "admin",',
					'  roles: ["admin"],',
					"}));",
				].join(" "),
			);

		project.addFile({
			files: () => [
				{ filePath: "src/entities/user.entity.ts", content: USER_ENTITY_TS },
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

function scaffold(workspace: WorkspaceScaffold, options: AuthOptions): void {
	if (options.authProvider !== "auth0") return;

	const resource = "Hello";
	const withLocalUsers = options.databaseProvider === "postgres/typeorm";

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
			?.addSideEffectImport("@decohere/http/auth");
	}

	if (withLocalUsers) {
		scaffoldLocalUserProfile(workspace);
		for (const project of workspace.getProjects()) {
			project
				.getModel<MainSourceFile>(WELL_KNOWN_FILES.MAIN_TS)
				?.addBuilderCall(".withAuth(defineAbilitiesFor, { principalMapper: mapPrincipal })");
		}
	} else {
		for (const project of workspace.getProjects()) {
			project
				.getModel<MainSourceFile>(WELL_KNOWN_FILES.MAIN_TS)
				?.addBuilderCall(".withAuth()");
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

	if (withLocalUsers && options.adminPassword) {
		createAuth0AdminUser(workspace, options, authConfig);
	}
}

export const AuthFeature: Feature<AuthOptions> = { getOptions, scaffold };
