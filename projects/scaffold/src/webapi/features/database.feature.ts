import { pick } from "../../domain/prompt.js";
import type { DockerCompose } from "../../models/compose.model.js";
import type { ConfigYaml } from "../../models/config-yaml.model.js";
import { WELL_KNOWN_FILES } from "../../models/const.js";
import type { DevContainer } from "../../models/dev-container.model.js";
import {
	type DockerfileModel,
	withPostgresqlClient,
} from "../../models/docker-image.model.js";
import type { EnvFile } from "../../models/env-file.model.js";
import type { Gitignore } from "../../models/gitignore.model.js";
import type { PackageJson } from "../../models/package-json.model.js";
import type { ProjectScaffold, WorkspaceScaffold } from "../../models/project.model.js";
import type { Feature } from "../../services/scaffold.service.js";
import { CREATE_VERSION } from "../../version.js";
import { apiEnvPrefix, apiNameFromProjectDir } from "../api-name.js";
import { type DatabaseProvider, type Orm, ormOf } from "../database-provider.js";
import type { ApiPackageJson } from "../models/api-package-json.model.js";
import type { MainSourceFile } from "../models/main-source-file.model.js";
import { MigrationsModel } from "../models/migrations.model.js";
import { sampleTable } from "./orm-templates.js";

/** Bind path relative to `.devcontainer/docker-compose.yml` (dies with the working tree). */
const POSTGRES_DATA_BIND = "./postgres-data:/var/lib/postgresql/data";
const POSTGRES_DATA_GITIGNORE = ".devcontainer/postgres-data";
/** The standard image's superuser. Only bootstraps the local server; no API connects as it. */
const POSTGRES_SUPERUSER = "postgres";
/** Sets up the data folder as you first, so Docker doesn't create it as root. */
const DB_UP_SCRIPT =
	"bash .devcontainer/initialize.sh && docker compose -f .devcontainer/docker-compose.yml up -d postgres";
const DB_RESET_SCRIPT = `docker compose -f .devcontainer/docker-compose.yml down && rm -rf .devcontainer/postgres-data && ${DB_UP_SCRIPT}`;

export type DatabaseOptions = {
	databaseProvider?: DatabaseProvider;
	/** When true, merge into an existing workspace (\`webapi add\`). */
	add?: boolean;
};

/** Safe Postgres identifier fragment from the project name. */
function toSqlIdentFragment(name: string): string {
	const cleaned = name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^([^A-Za-z_])/, "p_$1");
	return cleaned.length > 0 ? cleaned.slice(0, 40) : "app";
}

// Production: runtime app role only — no bootstrap, no admin/migrate secrets required.
function renderBaseDataSource(apiName: string): string {
	const p = apiEnvPrefix(apiName);
	return [
		`    - name: ${apiName}`,
		`      provider: postgres`,
		`      host: \${${p}_DB_HOST}`,
		`      port: \${${p}_DB_PORT}`,
		`      database: \${${p}_DB_NAME}`,
		`      username: \${${p}_DB_USER}`,
		`      password: \${${p}_DB_PASSWORD}`,
		`      synchronize: false`,
		`      seed: false`,
		`      bootstrap: false`,
	].join("\n");
}

// Dev overlay: @decohere/config merges it into config.yaml by data source name, so it only states
// what development changes. The local server trusts every connection, so there are no passwords;
// `password: null` replaces the production placeholder so it's never looked up. Migrations apply
// on start, so `db generate` always diffs against an up-to-date database.
function renderDevDataSource(apiName: string): string {
	const p = apiEnvPrefix(apiName);
	return [
		`    - name: ${apiName}`,
		`      auth: trust`,
		`      password: null`,
		`      migrateOnStart: true`,
		`      seed: true`,
		`      bootstrap: true`,
		`      adminUser: ${POSTGRES_SUPERUSER}`,
		`      migrateUsername: \${${p}_DB_MIGRATE_USER}`,
	].join("\n");
}

function renderDatabaseSection(
	apiNames: readonly string[],
	items: (name: string) => string,
): string {
	return `database:\n  dataSources:\n${apiNames.map(items).join("\n")}\n`;
}

const SAMPLE_REPOSITORY_TS = `import { injectable } from "@decohere/crucible/decorators";
import { injectUnitOfWork, type IUnitOfWork, Repository } from "@decohere/data";
import { SampleEntity } from "../entities/sample.entity.js";

@injectable()
export class SampleEntityRepository extends Repository<SampleEntity> {
\tpublic constructor(@injectUnitOfWork() unitOfWork: IUnitOfWork) {
\t\tsuper(unitOfWork, SampleEntity);
\t}
}
`;

/** The ORM packages the provider package is built on: the app installs the same range. */
const ORM_DEPENDENCIES: Record<Orm, Record<string, string>> = {
	"mikro-orm": { "@mikro-orm/core": "^7.2.8", "@mikro-orm/postgresql": "^7.2.8" },
	typeorm: { typeorm: "^1.1.2" },
};

const PROVIDER_PACKAGE: Record<Orm, string> = {
	"mikro-orm": "@decohere/data-mikro-orm",
	typeorm: "@decohere/data-typeorm",
};

const DATABASE_DOCS_MD = `# Database (Postgres)

## Roles

| Role | Env | Purpose |
|---|---|---|
| App | \`{PREFIX}_DB_USER\` | Runtime API (DML only in production) |
| Migrate | \`{PREFIX}_DB_MIGRATE_USER\` | Schema changes: \`pnpm decohere db\` commands, and migrations on start in development |
| Bootstrap | \`postgres\` | Create DB + roles when \`bootstrap: true\` (dev) |

\`{PREFIX}\` is the API slug in SCREAMING_SNAKE (\`api\` → \`API\`, \`billing\` → \`BILLING\`).

## No passwords locally

The local Postgres trusts every connection, so nothing here needs a password. \`config/config.dev.yaml\` declares this with \`auth: trust\`, and the app refuses that setting outside development. Its port is bound to \`127.0.0.1\`, so other machines can't connect, but anything on your machine or the Compose network can, so keep only development data in it.

Production still needs real passwords: \`{PREFIX}_DB_PASSWORD\` for the app, and \`{PREFIX}_DB_MIGRATE_PASSWORD\` for migrations.

## Changing the schema

Migrations live in \`projects/<api>/src/migrations/\`, listed in its \`index.ts\`. In development (\`config/config.dev.yaml\`, \`migrateOnStart: true\`) the API applies pending ones when it starts.

\`\`\`bash
pnpm decohere db generate add-expiry          # write a migration from your mapping changes; read it, then restart
pnpm decohere db new backfill-expiry --data   # a migration that changes rows, written by hand
pnpm decohere db status
pnpm decohere db revert
\`\`\`

With more than one API, name it: \`pnpm decohere db status --api billing\`. How it works, deploys, and changing a schema without downtime: https://github.com/typesmiths/decohere/blob/main/docs/recipes/migrations.md

## Production (migrations only)

\`config/config.yaml\` keeps \`synchronize: false\` / \`seed: false\` / \`bootstrap: false\`. Deploy steps:

1. Ensure the app database and roles already exist (provisioner / ops — not the API pod).
2. Run migrations as a release step, with the migrate role: \`node es6/src/db.js migrate\` in the packaged API, with \`{PREFIX}_DB_MIGRATE_USER\` and \`{PREFIX}_DB_MIGRATE_PASSWORD\` set.
3. Start the API with the app role only — no migrate/admin secrets on the pod.

## Scripts

| Script | What it does |
|---|---|
| \`db:up\` / \`db:down\` / \`db:reset\` | Local Compose Postgres |

## Browse the database

Prefer the Dev Container **SQLTools** extension (Postgres driver) or any desktop client against \`127.0.0.1:5433\`, as user \`postgres\` with no password.

Adminer is **not** scaffolded. If you want a browser UI in Compose, add this under \`services:\` in \`.devcontainer/docker-compose.yml\` (profile \`tools\` so it stays off by default):

\`\`\`yaml
  adminer:
    image: adminer
    profiles:
      - tools
    ports:
      - "127.0.0.1:8081:8080"
    networks:
      - <compose-network-key> # same key as postgres / devcontainer
\`\`\`

Then: \`docker compose -f .devcontainer/docker-compose.yml --profile tools up -d adminer\`
`;

async function getOptions(
	_workspace: WorkspaceScaffold,
	cliOptions: Partial<DatabaseOptions>,
): Promise<Partial<DatabaseOptions>> {
	if (cliOptions.databaseProvider != null) return {};

	const choices = [
		{ label: "none" as const },
		{ label: "postgres/mikro-orm" as const },
		{ label: "postgres/typeorm" as const },
	];
	const selected = await pick("\n  Database: ", choices, (c) => c.label);
	return { databaseProvider: selected?.label ?? "none" };
}

function scaffold(workspace: WorkspaceScaffold, options: DatabaseOptions): void {
	const orm = ormOf(options.databaseProvider);
	if (orm == null) return;

	const name = workspace.name;
	const ident = toSqlIdentFragment(name);
	const apiProjects = workspace.getProjects();
	const apiNames = apiProjects.map((project) => apiNameFromProjectDir(project.dir));
	const devContainer = workspace.getModel<DevContainer>(WELL_KNOWN_FILES.DEVCONTAINER_JSON);
	const compose = workspace.getModel<DockerCompose>(WELL_KNOWN_FILES.DOCKER_COMPOSE);

	const networkKey = name;

	// Skip when the workspace already runs Postgres (`decohere add api` on a database workspace).
	if (compose && !compose.hasService("postgres")) {
		// One shared instance. Each API owns a database on it (created at bootstrap).
		// Point `{PREFIX}_DB_HOST` / `{PREFIX}_DB_PORT` at another server to split later.
		// Default data is a bind mount under the project so `rm -rf` the tree removes it. Postgres
		// runs as you, from the IDs initialize.sh writes, or that delete would need sudo.
		compose
			.addHeaderComment(
				"Postgres data defaults to ./postgres-data under this folder (bind mount; dies with the working tree).",
				"It runs as you, using the IDs initialize.sh writes to .env here, so you can delete those files.",
				`For data that outlives the checkout, replace the postgres volumes entry with a named volume`,
				`e.g. "${name}-postgres-data:/var/lib/postgresql/data" and declare it under top-level volumes:.`,
			)
			.addService("postgres", {
				image: "postgres:16",
				user: "${DECOHERE_UID:-1000}:${DECOHERE_GID:-1000}",
				environment: { POSTGRES_HOST_AUTH_METHOD: "trust", POSTGRES_DB: ident },
				container_name: `samples-${name}-postgres`,
				restart: "unless-stopped",
				ports: ["127.0.0.1:5433:5432"],
				volumes: [POSTGRES_DATA_BIND],
				networks: [{ [networkKey]: { aliases: ["postgres"] } }],
				healthcheck: {
					test: ["CMD-SHELL", `pg_isready -U ${POSTGRES_SUPERUSER}`],
					interval: "2s",
					timeout: "5s",
					retries: 15,
				},
			});

		workspace.getModel<Gitignore>(WELL_KNOWN_FILES.GITIGNORE)?.add(POSTGRES_DATA_GITIGNORE);

		compose.addEnvFile("devcontainer", "../.env");
	}

	devContainer?.addExtension("mtxr.sqltools", "mtxr.sqltools-driver-pg");
	workspace
		.getModel<DockerfileModel>(WELL_KNOWN_FILES.DOCKERFILE)
		?.addLayer(withPostgresqlClient());

	const pkg = workspace
		.getModel<PackageJson>(WELL_KNOWN_FILES.PACKAGE_JSON)
		?.addDependency("@decohere/data", CREATE_VERSION)
		.addDependency(PROVIDER_PACKAGE[orm], CREATE_VERSION)
		.addDependency("@decohere/data-postgres", CREATE_VERSION)
		.addScript("db:up", DB_UP_SCRIPT)
		.addScript("db:down", "docker compose -f .devcontainer/docker-compose.yml down")
		.addScript("db:reset", DB_RESET_SCRIPT);

	if (pkg != null) {
		for (const [name, range] of Object.entries(ORM_DEPENDENCIES[orm])) {
			pkg.addDependency(name, range);
		}
	}

	workspace.addFile({
		files: () => [
			{
				filePath: "docs/database.md",
				content: DATABASE_DOCS_MD,
			},
		],
	});

	writeDatabaseConfig(workspace, apiNames);

	for (const project of apiProjects) {
		wireApiDatabase(project, orm);
	}

	for (const apiName of apiNames) {
		writeApiDatabaseEnv(workspace, ident, apiName);
	}
}

function writeDatabaseConfig(workspace: WorkspaceScaffold, apiNames: readonly string[]): void {
	const config = workspace.getModel<ConfigYaml>(WELL_KNOWN_FILES.CONFIG_YAML);
	const devConfig = workspace.getModel<ConfigYaml>(WELL_KNOWN_FILES.CONFIG_DEV_YAML);
	const pending = apiNames.filter((apiName) => !config?.hasDataSource(apiName));
	if (pending.length === 0) return;

	if (config?.hasDataSources()) {
		for (const apiName of pending) {
			config.appendDataSource(renderBaseDataSource(apiName));
			devConfig?.appendDataSource(renderDevDataSource(apiName));
		}
		return;
	}

	config?.addSection(renderDatabaseSection(pending, renderBaseDataSource));
	devConfig?.addSection(renderDatabaseSection(pending, renderDevDataSource));
}

function writeApiDatabaseEnv(
	workspace: WorkspaceScaffold,
	ident: string,
	apiName: string,
): void {
	const prefix = apiEnvPrefix(apiName);
	const sqlApi = toSqlIdentFragment(apiName);
	workspace
		.getModel<EnvFile>(WELL_KNOWN_FILES.ENV_FILE)
		?.addEntry(`${prefix}_DB_HOST`, "postgres")
		.addEntry(`${prefix}_DB_PORT`, "5432")
		.addEntry(`${prefix}_DB_NAME`, `${ident}_${sqlApi}_dev`)
		.addEntry(`${prefix}_DB_USER`, `${ident}_${sqlApi}_app`)
		.addEntry(`${prefix}_DB_MIGRATE_USER`, `${ident}_${sqlApi}_migrate`);
}

function wireApiDatabase(project: ProjectScaffold, orm: Orm): void {
	const apiName = apiNameFromProjectDir(project.dir);
	const sample = sampleTable(orm);
	project
		.getModel<MainSourceFile>(WELL_KNOWN_FILES.MAIN_TS)
		?.setOrm(orm)
		.setDataSourceName(apiName)
		.addEntity(sample.entity)
		.addRepository({
			className: "SampleEntityRepository",
			importPath: "./repositories/sample.repository.js",
		});
	const migrations =
		project.getModel<MigrationsModel>(WELL_KNOWN_FILES.MIGRATIONS) ??
		project.addModel(new MigrationsModel());
	migrations.add(sample.migration.name, sample.migration.up, sample.migration.down);
	const api = project.getModel<ApiPackageJson>(WELL_KNOWN_FILES.API_PACKAGE_JSON);
	api
		?.addDependency("@decohere/data", CREATE_VERSION)
		.addDependency(PROVIDER_PACKAGE[orm], CREATE_VERSION)
		.addDependency("@decohere/data-postgres", CREATE_VERSION);
	for (const [name, range] of Object.entries(ORM_DEPENDENCIES[orm])) {
		api?.addDependency(name, range);
	}
	project.addFile({
		files: () => [
			...sample.files,
			{
				filePath: "src/repositories/sample.repository.ts",
				content: SAMPLE_REPOSITORY_TS,
			},
		],
	});
}

export const DatabaseFeature: Feature<DatabaseOptions> = { getOptions, scaffold };
