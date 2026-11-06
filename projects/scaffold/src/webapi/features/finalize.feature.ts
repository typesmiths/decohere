import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PackageManager } from "@decohere/devkit/interop";
import { detectPackageManager, promptForPackageManager } from "@decohere/devkit/interop";
import { ask, closePrompt } from "../../domain/prompt.js";
import { WELL_KNOWN_FILES } from "../../models/const.js";
import type { EnvFile } from "../../models/env-file.model.js";
import type { WorkspaceScaffold } from "../../models/project.model.js";
import type { Feature } from "../../services/scaffold.service.js";
import { writeWorkspaceReadme } from "../workspace-readme.js";
import { formatScaffoldedFiles } from "./biome-format.js";

function readExistingEnvValue(workspace: WorkspaceScaffold, key: string): string | undefined {
	try {
		const raw = readFileSync(join(workspace.targetDir, ".env"), "utf8");
		const line = raw.split("\n").find((l) => l.startsWith(`${key}=`));
		const value = line?.slice(key.length + 1).trim();
		return value || undefined;
	} catch {
		return undefined;
	}
}

// State resolved during scaffold(), consumed by finalize().
let _pm: PackageManager | null = null;
let _shouldInstall = true;

type FinalizeOptions = {
	installDependencies?: "yes" | "no";
	add?: boolean;
	databaseProvider?: "none" | "postgres/typeorm";
	authProvider?: "auth0" | "none";
};

async function getOptions(
	_workspace: WorkspaceScaffold,
	cliOptions: Partial<FinalizeOptions>,
): Promise<object> {
	if (cliOptions.installDependencies != null) {
		_shouldInstall = cliOptions.installDependencies === "yes";
	}
	return {};
}

async function scaffold(
	workspace: WorkspaceScaffold,
	options: FinalizeOptions,
): Promise<void> {
	// Local scaffold default — production deploys must set NODE_ENV explicitly.
	const nodeEnv = readExistingEnvValue(workspace, "NODE_ENV") ?? "dev";
	workspace.getModel<EnvFile>(WELL_KNOWN_FILES.ENV_FILE)?.addEntry("NODE_ENV", nodeEnv);

	// Durable day-2 CLI examples (also refreshed on `webapi add`).
	writeWorkspaceReadme(workspace, options);

	if (process.env.DECOHERE_BUILDER === "1") {
		_shouldInstall = false;
		return;
	}
	_pm = detectPackageManager(workspace.targetDir) ?? (await promptForPackageManager());
	if (options.installDependencies != null) {
		_shouldInstall = options.installDependencies === "yes";
		return;
	}

	const answer = await ask("\nInstall dependencies now? [yes/no] (yes): ", "yes");
	_shouldInstall = answer.toLowerCase() !== "no";
}

async function finalize(
	workspace: WorkspaceScaffold,
	options: FinalizeOptions,
): Promise<void> {
	const formatPaths = options.add
		? workspace.getProjects().map((project) => project.dir)
		: ["."];
	formatScaffoldedFiles(workspace.targetDir, formatPaths.length > 0 ? formatPaths : ["."]);

	if (_shouldInstall) {
		const pm = _pm!;
		console.log(`\nScaffolded ${workspace.name}. Installing dependencies...\n`);
		await pm.install({ cwd: workspace.targetDir });
	}

	const apiNames = workspace
		.getProjects()
		.map((project) => project.dir.replace(/^projects\//, ""));
	console.log(`\nDone! ${_shouldInstall ? "Next" : "To get started:"} steps:\n`);
	if (!options.add) {
		console.log(`  cd ${workspace.name}`);
	}
	if (!_shouldInstall && options.add) {
		const pmName = _pm?.name ?? "pnpm";
		console.log(`  ${pmName} install`);
	}
	if (options.add && apiNames[0] != null) {
		console.log(`  pnpm run start:${apiNames[0]}`);
		console.log(`  pnpm run package:${apiNames[0]} && docker build projects/${apiNames[0]}`);
	} else {
		console.log("  code .         # open in VS Code");
		console.log(
			"                 # then: Reopen in Container (first create runs pnpm install)\n",
		);
	}
	console.log("  See README.md for CLI examples.\n");

	// Drop readline's stdin hold so the CLI / container can exit.
	closePrompt();
}

export const FinalizeFeature: Feature = { getOptions, scaffold, finalize };
