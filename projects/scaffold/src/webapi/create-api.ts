import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { DockerCompose } from "../models/compose.model.js";
import { ConfigYaml } from "../models/config-yaml.model.js";
import { WELL_KNOWN_FILES } from "../models/const.js";
import { DevContainer } from "../models/dev-container.model.js";
import {
	commandHistory,
	DockerfileModel,
	withWorkspaceNodeModulesOwnership,
} from "../models/docker-image.model.js";
import { EnvFile } from "../models/env-file.model.js";
import { Gitignore } from "../models/gitignore.model.js";
import { LaunchJson } from "../models/launch-json.model.js";
import { PackageJson, packageScript } from "../models/package-json.model.js";
import { MonoRepoScaffold, ProjectScaffold } from "../models/project.model.js";
import { TsConfig } from "../models/tsconfig.model.js";
import { VitestConfig } from "../models/vitest-config.model.js";
import { VSCodeSettings } from "../models/vscode-settings.model.js";
import { ScaffoldService } from "../services/scaffold.service.js";
import {
	CreateCliError,
	isDecohereWorkspace,
	listExistingApiNames,
	parseApiNames,
} from "./api-name.js";
import {
	DEFAULT_WEBAPI_NAME,
	webapiPackageName,
	webapiPort,
	webapiProjectDir,
	webapiReleaseEntry,
} from "./const.js";
import { DevContainerHostScripts } from "./devcontainer/host-scripts.js";
import { AuthFeature } from "./features/auth.feature.js";
import { DatabaseFeature } from "./features/database.feature.js";
import { FinalizeFeature } from "./features/finalize.feature.js";
import { ApiPackageJson } from "./models/api-package-json.model.js";
import { ControllerSourceFile } from "./models/controller-source-file.model.js";
import { GithubCiWorkflows } from "./models/github-ci.model.js";
import { MainSourceFile } from "./models/main-source-file.model.js";
import { WebapiProductionDockerfile } from "./models/production-dockerfile.model.js";
import { SampleConfigModel, SampleServiceModel } from "./models/sample-files.model.js";
import { WebapiDevContainer } from "./models/webapi-image.model.js";

export { WEBAPI_PROJECT_DIR, WEBAPI_RELEASE_ENTRY } from "./const.js";

export type ApiOptions = {
	d?: string;
	/** Host project name (directory basename). Required when scaffolding into the create-builder `/workspace` mount. */
	projectName?: string;
	/** API slugs under `projects/`. Default `["api"]`. Repeatable `--name`. */
	names?: string[];
	/** Add APIs to an existing Decohere workspace instead of creating a new one. */
	add?: boolean;
	authProvider?: "auth0" | "none";
	databaseProvider?: "none" | "postgres/typeorm";
	installDependencies?: "yes" | "no";
};

const features = [DatabaseFeature, AuthFeature, FinalizeFeature];

/**
 * Where a project's Auth0 CLI login lives on the host: in memory on Linux, and otherwise under the
 * home folder. One per project, so a project can't act on another's tenant. Keep in step with
 * `.devcontainer/initialize.sh`, which creates it first so Docker doesn't create it as root.
 */
const AUTH0_LOGIN_ROOT = "${XDG_RUNTIME_DIR:-${HOME}/.config/decohere}/decohere-auth0";

export async function scaffoldApi(cliOptions: ApiOptions) {
	const targetDir = resolve(cliOptions.d ?? ".");
	const projectName =
		cliOptions.projectName?.trim() ||
		process.env.DECOHERE_PROJECT_NAME?.trim() ||
		basename(targetDir);
	const names = parseApiNames(cliOptions.names);
	const workspace = cliOptions.add
		? createAddWorkspace(targetDir, projectName, names)
		: createWorkspace(targetDir, projectName, names);
	await ScaffoldService.scaffold(workspace, { ...cliOptions, names }, features);
}

function createWorkspace(
	targetDir: string,
	projectName: string,
	apiNames: readonly string[],
): MonoRepoScaffold {
	const monoRepo = new MonoRepoScaffold();
	monoRepo.targetDir = targetDir;
	monoRepo.setName(projectName);
	const name = monoRepo.name;
	// Project-named root so Cursor Agents (and other tools) label the workspace by name.
	const workspaceRoot = `/${name}`;

	const compose = new DockerCompose()
		.setProjectName(name)
		.addNetwork(name, { name: `samples-${name}` })
		.addService("devcontainer", {
			build: ".",
			volumes: [
				// Repo bind in Compose (survives CLI recreates; Cursor-only mounts do not).
				`..:${workspaceRoot}`,
				// Outside the project, one per project. initialize.sh creates it first on the host, because
				// Docker creates a missing host path as root.
				`\${HOME}/.config/decohere/gh/${name}:/home/node/.config/gh`,
				`webapi-node-modules:${workspaceRoot}/node_modules`,
				// Named volume (not a Cursor-only mount) so CLI recreates keep Up-arrow history.
				`${commandHistory.volumeName}:${commandHistory.dir}`,
				// A folder on the host, so a rebuild keeps the Auth0 CLI login and you can see it.
				`${AUTH0_LOGIN_ROOT}/${name}:/home/node/.config/auth0`,
			],
			env_file: [`\${HOME}/.config/decohere/gh/${name}.env`],
			command: "sleep infinity",
			networks: [name],
		})
		.addVolume("webapi-node-modules")
		.addVolume(commandHistory.volumeName);

	const installCmd = "bash .devcontainer/post-create.sh";
	const devContainer = new DevContainer()
		.setWorkspaceFolder(workspaceRoot)
		.addExtension("oxc.oxc-vscode", "esbenp.prettier-vscode", "vitest.explorer")
		.setInitializeCommand("bash .devcontainer/initialize.sh")
		.setPostCreateCommand(installCmd)
		.setUpdateContentCommand(installCmd)
		.useCompose();

	forwardApiPorts(devContainer, apiNames, 0);

	// Workspace-level models (repo root)
	monoRepo.addModel(compose);
	monoRepo.addModel(devContainer);
	const appDevImage = new WebapiDevContainer();
	appDevImage.addLayer(
		withWorkspaceNodeModulesOwnership({ workspaceDir: workspaceRoot, asRoot: true }),
	);
	monoRepo.addModel(appDevImage);
	monoRepo.addModel(new WebapiProductionDockerfile(apiNames));
	monoRepo.addModel(new GithubCiWorkflows());
	monoRepo.addModel(new VSCodeSettings(name));
	monoRepo.addModel(new LaunchJson(apiNames));
	monoRepo.addModel(new TsConfig());
	monoRepo.addModel(new VitestConfig());
	monoRepo.addModel(new PackageJson(`${name}.api`, { apiNames, workspaceName: name }));
	monoRepo.addModel(new ConfigYaml(WELL_KNOWN_FILES.CONFIG_YAML, "config/config.yaml", ""));
	monoRepo.addModel(
		new ConfigYaml(WELL_KNOWN_FILES.CONFIG_DEV_YAML, "config/config.dev.yaml", ""),
	);
	monoRepo.addModel(new Gitignore());
	monoRepo.addModel(new EnvFile());
	monoRepo.addFile(new DevContainerHostScripts());

	// Current pnpm fails the install on any dependency's install script nobody has decided about.
	// The app works without these two, so decide "don't run" rather than run third-party scripts.
	monoRepo.addFile({
		files: () => [
			{
				filePath: "pnpm-workspace.yaml",
				content: 'allowBuilds:\n  "@swc/core": false\n  esbuild: false\n',
			},
		],
	});

	// The same linter and formatter, set up the same way, as Decohere itself.
	monoRepo.addFile({
		files: () => [
			{
				filePath: ".oxlintrc.json",
				content: JSON.stringify(
					{
						$schema: "./node_modules/oxlint/configuration_schema.json",
						ignorePatterns: ["**/dist/**", "**/.package/**"],
					},
					null,
					2,
				),
			},
			{
				filePath: ".prettierrc.json",
				content: JSON.stringify(
					{
						useTabs: true,
						printWidth: 95,
						overrides: [
							{
								files: ["*.json", "*.yml", "*.yaml"],
								options: { useTabs: false, tabWidth: 2 },
							},
						],
					},
					null,
					2,
				),
			},
			{
				filePath: ".prettierignore",
				content: [".devcontainer", "pnpm-lock.yaml", "*.md", ""].join("\n"),
			},
		],
	});

	for (const apiName of apiNames) {
		addApiProject(monoRepo, name, apiName);
	}

	return monoRepo;
}

function createAddWorkspace(
	targetDir: string,
	projectName: string,
	apiNames: readonly string[],
): MonoRepoScaffold {
	if (!isDecohereWorkspace(targetDir)) {
		throw new CreateCliError(
			`Not a Decohere workspace: ${targetDir}. Scaffold one first with \`npx @decohere/create webapi\`.`,
		);
	}

	const existing = listExistingApiNames(targetDir);
	for (const apiName of apiNames) {
		if (existing.includes(apiName)) {
			throw new CreateCliError(
				`API "${apiName}" already exists at ${webapiProjectDir(apiName)}.`,
			);
		}
	}

	const monoRepo = new MonoRepoScaffold();
	monoRepo.targetDir = targetDir;
	monoRepo.setName(projectName);
	const name = monoRepo.name;

	const pkg = PackageJson.fromFile(join(targetDir, "package.json"));
	monoRepo.addModel(pkg);
	monoRepo.addModel(
		existsSync(join(targetDir, ".env"))
			? EnvFile.fromFile(join(targetDir, ".env"))
			: new EnvFile(),
	);
	monoRepo.addModel(
		existsSync(join(targetDir, "config/config.yaml"))
			? ConfigYaml.fromFile(
					WELL_KNOWN_FILES.CONFIG_YAML,
					"config/config.yaml",
					join(targetDir, "config/config.yaml"),
				)
			: new ConfigYaml(WELL_KNOWN_FILES.CONFIG_YAML, "config/config.yaml", ""),
	);
	monoRepo.addModel(
		existsSync(join(targetDir, "config/config.dev.yaml"))
			? ConfigYaml.fromFile(
					WELL_KNOWN_FILES.CONFIG_DEV_YAML,
					"config/config.dev.yaml",
					join(targetDir, "config/config.dev.yaml"),
				)
			: new ConfigYaml(WELL_KNOWN_FILES.CONFIG_DEV_YAML, "config/config.dev.yaml", ""),
	);

	// Load the workspace files features merge into, so e.g. --database on a workspace
	// created without one adds the Postgres service instead of only the db:* scripts.
	const compose = loadIfExists(targetDir, ".devcontainer/docker-compose.yml", (path) =>
		DockerCompose.fromFile(path),
	);
	if (compose) monoRepo.addModel(compose);
	const devContainer = loadIfExists(targetDir, ".devcontainer/devcontainer.json", (path) =>
		DevContainer.fromFile(path),
	);
	if (devContainer) {
		forwardApiPorts(devContainer, apiNames, existing.length);
		monoRepo.addModel(devContainer);
	}
	const devImage = loadIfExists(targetDir, ".devcontainer/Dockerfile", (path) =>
		DockerfileModel.fromFile(path, ".devcontainer/Dockerfile"),
	);
	if (devImage) monoRepo.addModel(devImage);
	const gitignore = loadIfExists(targetDir, ".gitignore", (path) => Gitignore.fromFile(path));
	if (gitignore) monoRepo.addModel(gitignore);

	if (!pkg.hasScript("package")) {
		pkg.addScript("package", "pnpm run build && forge package");
	}
	for (const [offset, apiName] of apiNames.entries()) {
		const port = webapiPort(existing.length + offset);
		pkg.addScript(`start:${apiName}`, `node ${webapiReleaseEntry(apiName)}`);
		pkg.addScript(`package:${apiName}`, packageScript(name, apiName));
		pkg.addScript(
			`dev:${apiName}`,
			`PORT=${port} flux serve --env-file-if-exists .env --project ${webapiPackageName(name, apiName)}`,
		);
		addApiProject(monoRepo, name, apiName);
	}
	monoRepo.addModel(new WebapiProductionDockerfile(apiNames));

	return monoRepo;
}

function addApiProject(
	monoRepo: MonoRepoScaffold,
	workspaceName: string,
	apiName: string,
): void {
	const apiProject = new ProjectScaffold(webapiProjectDir(apiName));
	apiProject.addModel(new ApiPackageJson(workspaceName, apiName));
	apiProject.addModel(new MainSourceFile(`${workspaceName}.${apiName}`));
	apiProject.addModel(new ControllerSourceFile());
	apiProject.addFile(new SampleConfigModel());
	apiProject.addFile(new SampleServiceModel());
	monoRepo.addProject(apiProject);
}

function forwardApiPorts(
	devContainer: DevContainer,
	apiNames: readonly string[],
	firstIndex: number,
): void {
	for (const [offset, apiName] of apiNames.entries()) {
		const port = webapiPort(firstIndex + offset);
		devContainer.forwardPort(port);
		devContainer.setPortAttributes(port, {
			label: apiName === DEFAULT_WEBAPI_NAME ? "API" : apiName,
			requireLocalPort: true,
		});
	}
}

function loadIfExists<T>(
	targetDir: string,
	relativePath: string,
	load: (absolutePath: string) => T,
): T | undefined {
	const absolutePath = join(targetDir, relativePath);
	return existsSync(absolutePath) ? load(absolutePath) : undefined;
}
