import { WELL_KNOWN_FILES } from "../models/const.js";
import type { EnvFile } from "../models/env-file.model.js";
import type { PackageJson } from "../models/package-json.model.js";
import type { WorkspaceScaffold } from "../models/project.model.js";
import { apiNameFromProjectDir, listExistingApiNames } from "./api-name.js";

export type WorkspaceReadmeOptions = {
	add?: boolean;
	databaseProvider?: "none" | "postgres/typeorm";
	authProvider?: "auth0" | "none";
};

export type WorkspaceReadmeInput = {
	projectName: string;
	apiNames: readonly string[];
	hasPostgres: boolean;
	hasAuth0: boolean;
};

/** Pure renderer — keep feature sections short and copy-paste ready. */
export function renderWorkspaceReadme(input: WorkspaceReadmeInput): string {
	const { projectName, apiNames, hasPostgres, hasAuth0 } = input;
	const apis = apiNames.length > 0 ? apiNames : ["api"];
	const lines: string[] = [
		`# ${projectName}`,
		"",
		"Decohere web API workspace. Scaffolded with [`@decohere/create`](https://www.npmjs.com/package/@decohere/create).",
		"",
		"## Get started",
		"",
		"1. Open this folder in VS Code / Cursor.",
		"2. **Reopen in Container** (or rebuild the Dev Container).",
		"3. Install dependencies if needed:",
		"",
		"```bash",
		"pnpm install",
		"```",
		"",
		"## Develop",
		"",
		"```bash",
		"pnpm dev              # Flux HMR (first API)",
		"pnpm start            # run the compiled first API",
		"pnpm run build        # forge release build",
		"pnpm run package      # release build + .package/ for each API (what Docker copies)",
	];

	for (const name of apis) {
		lines.push(`pnpm run dev:${name}     # HMR for ${name}`);
		lines.push(`pnpm run start:${name}   # production entry for ${name}`);
	}

	lines.push("```", "");

	lines.push(
		"## Logging",
		"",
		"In development, Scribe uses pino-pretty and rolling files under `logs/` (gitignored).",
		"When `NODE_ENV=production`, the process writes structured JSON to stdout and does not rotate files.",
		"Ship and retain those streams outside the app (platform logs, a sidecar, or a log agent) so shipping can change without rebuilding.",
		"",
		"Override roll path and rotation without changing app code:",
		"`SCRIBE_LOG_FILE`, `SCRIBE_LOG_SIZE`, `SCRIBE_LOG_FREQUENCY`, `SCRIBE_LOG_KEEP`.",
		"",
		'Opt into in-process pretty or roll in production only with `{ when: "always" }` on `scribe.withPinoPretty` / `scribe.withPinoRoll`.',
		"",
	);

	if (hasPostgres) {
		lines.push(
			"## Database",
			"",
			"Postgres runs via Dev Container Compose:",
			"",
			"```bash",
			"pnpm db:up",
			"pnpm db:down",
			"pnpm db:reset",
			"```",
			"",
		);
	}

	lines.push(
		"## Deploy",
		"",
		"Each API has its own `projects/<name>/Dockerfile`. It copies `.package/`, which `forge package`",
		"writes before Docker runs: the API's compiled code, the workspace libraries it imports, and",
		"a plain `node_modules` of the third-party packages it uses (no symlinks). The image build",
		"installs nothing and needs no npm token.",
		"",
		"```bash",
		"pnpm run package         # release build, then .package/ in every API",
		`docker build -t ${projectName} projects/api`,
		"```",
		"",
		"One API: `pnpm run package:<name>`, then `docker build projects/<name>`.",
		"A host that builds from a git clone does not have `.package/`; build and push the image",
		"from CI instead (`forge docker` after `pnpm run package`).",
		"",
	);

	lines.push(
		"## Add another API",
		"",
		"```bash",
		"decohere add api <name>",
		"```",
		"",
		"Example: `decohere add api billing`",
		"",
	);

	if (hasAuth0) {
		lines.push(
			"## Auth0",
			"",
			"JWT auth is wired from `.env` (`AUTH0_ISSUER_BASE_URL`, `AUTH0_AUDIENCE`).",
			'After you add a controller, `@Authorize("read", "Invoice")` becomes the Auth0 permission `read:Invoice`.',
			"Sync the Auth0 API and admin grants without re-scaffolding:",
			"",
			"```bash",
			"npx @decohere/create auth0 login      # once / when the CLI token expires",
			"npx @decohere/create auth0 configure  # after new @Authorize decorators",
			"```",
			"",
			"To get a token for protected routes, add an application for your client in the Auth0 dashboard.",
			"",
		);
	}

	lines.push(
		"## Try the API in Postman",
		"",
		"While the API is running, choose Import in Postman and paste `http://localhost:3000/openapi.json`.",
		"Import it again after you change a route.",
		"",
	);

	lines.push(
		"## More",
		"",
		"- Package docs: https://www.npmjs.com/package/@decohere/create",
		"- After `decohere add api`, this README is refreshed so scripts and APIs stay accurate.",
		"",
	);

	return `${lines.join("\n")}`;
}

export function resolveWorkspaceReadmeInput(
	workspace: WorkspaceScaffold,
	options: WorkspaceReadmeOptions,
): WorkspaceReadmeInput {
	const newNames = workspace
		.getProjects()
		.map((project) => apiNameFromProjectDir(project.dir));
	const apiNames = options.add
		? mergeApiNames(listExistingApiNames(workspace.targetDir), newNames)
		: newNames;

	const pkg = workspace.getModel<PackageJson>(WELL_KNOWN_FILES.PACKAGE_JSON);
	const env = workspace.getModel<EnvFile>(WELL_KNOWN_FILES.ENV_FILE);

	const hasPostgres =
		options.databaseProvider === "postgres/typeorm" || Boolean(pkg?.hasScript("db:up"));
	const hasAuth0 =
		options.authProvider === "auth0" || Boolean(env?.hasEntry("AUTH0_ISSUER_BASE_URL"));

	return {
		projectName: workspace.name,
		apiNames,
		hasPostgres,
		hasAuth0,
	};
}

export function writeWorkspaceReadme(
	workspace: WorkspaceScaffold,
	options: WorkspaceReadmeOptions,
): void {
	const content = renderWorkspaceReadme(resolveWorkspaceReadmeInput(workspace, options));
	workspace.addFile({
		files: () => [{ filePath: "README.md", content }],
	});
}

function mergeApiNames(existing: readonly string[], added: readonly string[]): string[] {
	const seen = new Set(existing);
	return [...existing, ...added.filter((name) => !seen.has(name))];
}
