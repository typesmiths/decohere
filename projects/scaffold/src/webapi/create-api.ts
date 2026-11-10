import { basename, resolve } from "node:path";
import type { PackageManager } from "@decohere/devkit/interop";
import { detectPackageManager, promptForPackageManager } from "@decohere/devkit/interop";
import { ask, closePrompt, pick } from "../domain/prompt.js";
import type { AppTarget } from "../steps/apps.js";
import { auth0Step } from "../steps/auth0.step.js";
import { postgresStep } from "../steps/postgres.step.js";
import { usersStep } from "../steps/users.step.js";
import { merge } from "../templates/merge.js";
import { templates } from "../templates/templates.js";
import { WorkspaceChanges } from "../templates/workspace-changes.js";
import {
	CreateCliError,
	isDecohereWorkspace,
	listExistingApiNames,
	parseApiNames,
} from "./api-name.js";
import {
	type Auth0ApiChoice,
	askAuth0Api,
	configureTenant,
	createAdminUser,
} from "./auth0-commands.js";
import { DEFAULT_WEBAPI_NAME, webapiPort, webapiProjectDir } from "./const.js";
import { DATABASE_PROVIDERS, type DatabaseProvider, ormOf } from "./database-provider.js";
import { formatScaffoldedFiles } from "./format-files.js";
import { printByHand } from "./print-by-hand.js";

export type ApiOptions = {
	d?: string;
	/** Host project name (directory basename). Required when scaffolding into the create-builder `/workspace` mount. */
	projectName?: string;
	/** API slugs under `projects/`. Default `["api"]`. Repeatable `--name`. */
	names?: string[];
	/** Add APIs to an existing Decohere workspace instead of creating a new one. */
	add?: boolean;
	authProvider?: "auth0" | "none";
	databaseProvider?: DatabaseProvider;
	installDependencies?: "yes" | "no";
	/** The Auth0 API to use, instead of asking. */
	auth0Api?: Auth0ApiChoice;
	/** The Auth0 admin's username, instead of asking (with a database and Auth0). */
	adminUsername?: string;
	/** The Auth0 admin's password. Otherwise the launcher's, from `DECOHERE_ADMIN_PASSWORD`. */
	adminPassword?: string;
};

/** The recipe every web API starts from: templates/recipes/webapi. */
const RECIPE = "recipes/webapi";

async function askDatabase(): Promise<DatabaseProvider> {
	const choices = DATABASE_PROVIDERS.map((label) => ({ label }));
	return (await pick("\n  Database: ", choices, (c) => c.label))?.label ?? "none";
}

async function askAuth(): Promise<"auth0" | "none"> {
	const choices = [{ label: "none" as const }, { label: "auth0" as const }];
	return (await pick("\n  Auth provider: ", choices, (c) => c.label))?.label ?? "none";
}

/** Copies the recipe in as `projects/<name>/`, and forwards its port from the Dev Container. */
function addApp(changes: WorkspaceChanges, workspace: string, target: AppTarget): void {
	templates.apply(changes, RECIPE, { workspace, app: target.name, port: target.port });
	const path = ".devcontainer/devcontainer.json";
	const devcontainer = changes.read(path);
	if (devcontainer == null) return;
	const label = target.name === DEFAULT_WEBAPI_NAME ? "API" : target.name;
	const ports = JSON.stringify({
		forwardPorts: [target.port],
		portsAttributes: { [target.port]: { label, requireLocalPort: true } },
	});
	const merged = merge.json(devcontainer, ports, path);
	if (merged == null) {
		changes.tellByHand(path, [`Forward port ${target.port} for ${target.name}.`]);
		return;
	}
	changes.write(path, merged);
}

/**
 * `decohere create webapi` and `decohere add api`: the web API recipe for each name, then the
 * chosen add steps on top. Every question is asked before Auth0 or the disk changes.
 */
export async function scaffoldApi(options: ApiOptions): Promise<void> {
	const targetDir = resolve(options.d ?? ".");
	const workspace =
		options.projectName?.trim() ||
		process.env.DECOHERE_PROJECT_NAME?.trim() ||
		basename(targetDir);
	const names = parseApiNames(options.names);
	const existing = options.add ? checkCanAdd(targetDir, names) : [];
	const targets = names.map((name, index) => ({
		name,
		port: webapiPort(existing.length + index),
	}));

	const orm = ormOf(options.databaseProvider ?? (await askDatabase()));
	const withAuth0 = (options.authProvider ?? (await askAuth())) === "auth0";
	const auth0Api = withAuth0
		? (options.auth0Api ?? (await askAuth0Api(workspace)))
		: undefined;
	const withUsers = withAuth0 && orm != null;
	const adminUsername = withUsers
		? (options.adminUsername ?? (await ask("\n  Admin username [admin]: ", "admin")))
		: undefined;
	const install = await askInstall(targetDir, options.installDependencies);

	// Auth0 changes only once every question is answered.
	const appCount = existing.length + names.length;
	const auth0Env = auth0Api ? configureTenant(targetDir, workspace, appCount, auth0Api) : {};
	const adminEnv =
		adminUsername != null
			? createAdminUser(
					workspace,
					adminUsername,
					options.adminPassword ?? process.env.DECOHERE_ADMIN_PASSWORD,
				)
			: {};

	const changes = new WorkspaceChanges(targetDir);
	if (!options.add) {
		const [first] = targets;
		templates.apply(changes, "workspace", { workspace, app: first.name, port: first.port });
	}
	for (const target of targets) addApp(changes, workspace, target);
	if (orm != null) postgresStep.apply(changes, workspace, targets, orm);
	if (withAuth0) auth0Step.apply(changes, workspace, targets, auth0Env);
	if (withUsers) usersStep.apply(changes, workspace, targets, adminEnv);
	const written = changes.commit();

	await finish(targetDir, workspace, names, { add: options.add === true, install, written });
	printByHand(changes);
}

function checkCanAdd(targetDir: string, names: readonly string[]): string[] {
	if (!isDecohereWorkspace(targetDir)) {
		throw new CreateCliError(
			`Not a Decohere workspace: ${targetDir}. Scaffold one first with \`npx @decohere/create webapi\`.`,
		);
	}
	const existing = listExistingApiNames(targetDir);
	for (const name of names) {
		if (existing.includes(name)) {
			throw new CreateCliError(`API "${name}" already exists at ${webapiProjectDir(name)}.`);
		}
	}
	return existing;
}

type Install = { pm: PackageManager; run: boolean } | undefined;

/** Whether to install once the files are written. The scaffolder image never installs. */
async function askInstall(
	targetDir: string,
	mode: "yes" | "no" | undefined,
): Promise<Install> {
	if (process.env.DECOHERE_BUILDER === "1") return undefined;
	const pm = detectPackageManager(targetDir) ?? (await promptForPackageManager());
	if (mode != null) return { pm, run: mode === "yes" };
	const answer = await ask("\nInstall dependencies now? [yes/no] (yes): ", "yes");
	return { pm, run: answer.toLowerCase() !== "no" };
}

async function finish(
	targetDir: string,
	workspace: string,
	names: readonly string[],
	done: { add: boolean; install: Install; written: string[] },
): Promise<void> {
	// The scaffolder image has no Prettier. A new project formats itself on its first install, in
	// `.devcontainer/post-create.sh`.
	if (done.install != null) {
		const paths = done.add ? done.written : ["."];
		if (paths.length > 0) formatScaffoldedFiles(targetDir, paths);
	}
	if (done.install?.run) {
		console.log(`\nScaffolded ${workspace}. Installing dependencies...\n`);
		await done.install.pm.install({ cwd: targetDir });
	}
	// Whatever started the scaffolder says what to do next: only it knows where the project ends up.
	if (done.install == null) {
		closePrompt();
		return;
	}
	console.log(`\nDone! ${done.install.run ? "Next" : "To get started:"} steps:\n`);
	if (done.add) {
		if (!done.install.run) console.log(`  ${done.install.pm.name} install`);
		console.log(`  pnpm run dev:${names[0]}`);
		console.log(`  pnpm run package:${names[0]} && docker build projects/${names[0]}`);
	} else {
		console.log(`  cd ${workspace}`);
		console.log("  code .         # open in VS Code");
		console.log(
			"                 # then: Reopen in Container (first create runs pnpm install)\n",
		);
	}
	console.log("  See README.md for what to run next.\n");
	// Drop readline's stdin hold so the CLI / container can exit.
	closePrompt();
}
