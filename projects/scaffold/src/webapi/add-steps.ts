import { basename, resolve } from "node:path";
import type { AppTarget } from "../steps/apps.js";
import { apps } from "../steps/apps.js";
import { auth0Step } from "../steps/auth0.step.js";
import { postgresStep } from "../steps/postgres.step.js";
import { usersStep } from "../steps/users.step.js";
import { WorkspaceChanges } from "../templates/workspace-changes.js";
import { CreateCliError, isDecohereWorkspace, listExistingApiNames } from "./api-name.js";
import { configureTenant, createAdminUser } from "./auth0-commands.js";
import { webapiPort } from "./const.js";
import type { Orm } from "./database-provider.js";
import { formatScaffoldedFiles } from "./format-files.js";
import { printByHand } from "./print-by-hand.js";

export type AddStepOptions = {
	/** List what would change, and change nothing (Auth0 included). */
	dryRun?: boolean;
};

type Workspace = { targetDir: string; name: string; targets: AppTarget[] };

function openWorkspace(directory: string): Workspace {
	const targetDir = resolve(directory);
	if (!isDecohereWorkspace(targetDir)) {
		throw new CreateCliError(
			`Not a Decohere workspace: ${targetDir}. Scaffold one first with \`npx @decohere/create webapi\`.`,
		);
	}
	const name = process.env.DECOHERE_PROJECT_NAME?.trim() || basename(targetDir);
	const targets = listExistingApiNames(targetDir).map((app, index) => ({
		name: app,
		port: webapiPort(index),
	}));
	return { targetDir, name, targets };
}

/** Writes the changes, or with `--dry-run` lists them, then says what's left to do by hand. */
function finish(changes: WorkspaceChanges, options: AddStepOptions): void {
	if (options.dryRun) {
		const changed = changes.changedFiles();
		console.log(changed.length > 0 ? "\n  Would change:" : "\n  Nothing to change.");
		for (const path of changed) console.log(`    ${path}`);
	} else {
		const written = changes.commit();
		if (written.length > 0) formatScaffoldedFiles(changes.root, written);
		for (const path of written) console.log(`  ✓ ${path}`);
	}
	printByHand(changes);
}

/** Apps with both Postgres and Auth0 but no local users yet: `add users` is the next step. */
function suggestUsers(changes: WorkspaceChanges, targets: AppTarget[]): void {
	const without = targets.filter(
		({ name }) =>
			apps.ormOf(changes, name) != null &&
			apps.hasAuth(changes, name) &&
			changes.read(`projects/${name}/src/services/user.service.ts`) == null,
	);
	if (without.length === 0) return;
	console.log("\n  With Postgres and Auth0, each user can have a local profile:");
	console.log("\n    pnpm decohere add users\n");
}

/** `decohere add postgres`: Postgres in the Dev Container, and a database for each app. */
export function runAddPostgres(directory = ".", options: AddStepOptions & { orm?: Orm } = {}) {
	const workspace = openWorkspace(directory);
	const changes = new WorkspaceChanges(workspace.targetDir);
	postgresStep.apply(changes, workspace.name, workspace.targets, options.orm ?? "mikro-orm");
	finish(changes, options);
	suggestUsers(changes, workspace.targets);
}

/** `decohere add auth0`. Sets up Auth0 first, so a failed login leaves the source untouched. */
export function runAddAuth0(directory = ".", options: AddStepOptions = {}): void {
	const workspace = openWorkspace(directory);
	const env = options.dryRun
		? {}
		: configureTenant(workspace.targetDir, workspace.name, workspace.targets.length);
	const changes = new WorkspaceChanges(workspace.targetDir);
	auth0Step.apply(changes, workspace.name, workspace.targets, env);
	finish(changes, options);
	console.log(
		"\n  ✓ Auth0 added. Every route now needs a token, unless it has @AllowAnonymous().",
	);
	console.log('    After adding @Authorize("read", "Invoice") to a route, run:');
	console.log("\n    pnpm decohere auth0 configure\n");
	console.log("  Call your API with a token:");
	console.log(
		'\n    curl -H "Authorization: Bearer $(pnpm -s decohere auth0 token)" localhost:3000/<route>\n',
	);
	suggestUsers(changes, workspace.targets);
}

/**
 * `decohere add users`: a local profile for each user Auth0 signs in. With the launcher's admin
 * password (`DECOHERE_ADMIN_PASSWORD`), also creates the admin user on Auth0.
 */
export function runAddUsers(
	directory = ".",
	options: AddStepOptions & { admin?: string } = {},
) {
	const workspace = openWorkspace(directory);
	const changes = new WorkspaceChanges(workspace.targetDir);
	const ready = usersStep.check(new WorkspaceChanges(workspace.targetDir), workspace.targets);
	const env =
		options.dryRun || ready.size === 0
			? {}
			: createAdminUser(
					workspace.name,
					options.admin ?? "admin",
					process.env.DECOHERE_ADMIN_PASSWORD,
				);
	usersStep.apply(changes, workspace.name, workspace.targets, env);
	finish(changes, options);
}
