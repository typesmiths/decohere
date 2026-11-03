import path from "node:path";
import { injectable } from "@decohere/crucible/decorators";
import type { PackageJson, Project } from "@decohere/workspace";
import { Workspace } from "@decohere/workspace";
import type { Action, ResultStatus } from "@decohere/devkit/cli";
import { ActionResponse } from "@decohere/devkit/cli";
import { Docker as DockerInterop } from "@decohere/devkit/interop";
import { io } from "@decohere/core/io";
import { scribe } from "@decohere/scribe";
import { ForgeError, formatUnknownError } from "../errors.js";
import { deployable, PACKAGE_DIR } from "../packaging/deployable.js";

export type DockerOptions = {
	configuration: string;
	dryRun?: boolean;
	push?: boolean;
};

export type DockerResponse = ResultStatus & {
	projectName: string;
	image: string;
	tags: string[];
	message: string;
};

@injectable()
export class Docker implements Action<DockerOptions> {
	#logger = scribe.logger(Docker.name);
	private readonly docker = new DockerInterop();
	readonly #defaultRegistry = process.env.FORGE_DOCKER_REGISTRY?.trim() || "ghcr.io";

	public constructor(private readonly workspace: Workspace) {}

	public async run(options: DockerOptions): Promise<ActionResponse<DockerResponse>> {
		const projects = await this.getDockerProjects(
			this.workspace.getProjects(options.configuration),
		);
		if (projects.length === 0) {
			this.#logger.info("No projects found with a Dockerfile — nothing to dockerize");
			return ActionResponse.Success(Docker.name, []);
		}

		const workspacePackageJson = await this.workspace.getPackageJson();
		const version = await this.workspace.getVersion();
		const responses = await Promise.all(
			projects.map(
				async (project) =>
					await this.buildProject(project, workspacePackageJson, version, options),
			),
		);
		const failed = responses.filter((response) => !response.succeeded);
		if (failed.length > 0) {
			return ActionResponse.Error(Docker.name, responses);
		}
		return ActionResponse.Success(Docker.name, responses);
	}

	private async getDockerProjects(projects: readonly Project[]) {
		const result: Project[] = [];
		for (const project of projects) {
			if (!(await deployable.isDeployable(project))) {
				this.#logger.info(
					`Skipping ${project.name}: missing ${deployable.dockerfileName(project)}`,
				);
				continue;
			}

			result.push(project);
		}
		return result;
	}

	/**
	 * A Dockerfile that copies `.package/` needs `forge package` to have run. Fail before the
	 * build with that instruction rather than with Docker's "not found" from deep in a layer.
	 */
	private async assertPackaged(project: Project): Promise<void> {
		const dockerfile = await io.readFile(deployable.dockerfilePath(project)).catch(() => "");
		if (!dockerfile.includes(PACKAGE_DIR)) {
			return;
		}
		const packaged = path.join(project.projectRoot, PACKAGE_DIR, "package.json");
		if (!(await io.fileExists(packaged))) {
			throw new ForgeError(
				`${project.name}: its Dockerfile copies ${PACKAGE_DIR}/, which does not exist. ` +
					`Run \`forge build --configuration release\` and \`forge package ${project.name}\` first.`,
			);
		}
	}

	private async buildProject(
		project: Project,
		workspacePackageJson: PackageJson,
		version: string,
		options: DockerOptions,
	): Promise<DockerResponse> {
		const dockerConfig = project.dockerConfig ?? {};
		const envBuildArgs = this.parseJsonEnv<Record<string, string>>(
			"FORGE_DOCKER_BUILD_ARGS_JSON",
			{},
		);
		const envSecrets = this.parseJsonEnv<Record<string, string>>(
			"FORGE_DOCKER_SECRETS_JSON",
			{},
		);
		const envTags = this.parseJsonEnv<string[]>("FORGE_DOCKER_EXTRA_TAGS_JSON", []);

		const image =
			dockerConfig.image ?? this.defaultImageName(project.name, workspacePackageJson);
		const dockerfile = dockerConfig.dockerfile ?? "Dockerfile";
		const extraTags = this.extraTagsForImage(image, [
			...(dockerConfig.tags ?? []),
			...envTags,
		]);
		const tags = [`${image}:${version}`, ...extraTags];
		const buildArgs = this.interpolateBuildArgs(
			{ ...dockerConfig.buildArgs, ...envBuildArgs },
			version,
		);
		const secrets = { ...dockerConfig.secrets, ...envSecrets };

		this.#logger.info(`${options.dryRun ? "[dry-run] " : ""}Building ${project.name}`);
		try {
			await this.assertPackaged(project);
			await this.docker.build(project.projectRoot, {
				cwd: project.projectRoot,
				dockerfile: path.join(project.projectRoot, dockerfile),
				tags,
				buildArgs,
				secrets,
			});

			const shouldPush = options.push || dockerConfig.push;
			if (shouldPush && !options.dryRun) {
				for (const tag of tags) {
					await this.docker.push(tag, { cwd: project.projectRoot });
				}
			} else if (shouldPush && options.dryRun) {
				this.#logger.info(`[dry-run] Skipping push for ${project.name}`);
			}

			return {
				projectName: project.name,
				image,
				tags,
				succeeded: true,
				message: options.dryRun ? `Built ${image} (not pushed)` : `Built ${image}`,
			};
		} catch (reason) {
			const message = formatUnknownError(reason);
			return {
				projectName: project.name,
				image,
				tags,
				succeeded: false,
				message,
				error: `${project.name}: ${message}`,
			};
		}
	}

	private interpolateBuildArgs(
		buildArgs: Record<string, string> | undefined,
		version: string,
	) {
		const result: Record<string, string> = {};
		const versionPlaceholder = "$" + "{version}";
		for (const [key, value] of Object.entries(buildArgs ?? {})) {
			result[key] = value.split(versionPlaceholder).join(version);
		}
		return result;
	}

	/**
	 * Keep FORGE_DOCKER_EXTRA_TAGS_JSON scoped to this image so multi-image
	 * publishes do not stamp create:latest onto the app Dev Container (and vice versa).
	 */
	private extraTagsForImage(image: string, tags: readonly string[]): string[] {
		const prefix = `${image}:`;
		const seen = new Set<string>();
		const result: string[] = [];
		for (const tag of tags) {
			if (tag === image || tag.startsWith(prefix)) {
				if (!seen.has(tag)) {
					seen.add(tag);
					result.push(tag);
				}
			}
		}
		return result;
	}

	private defaultImageName(projectName: string, workspacePackageJson: PackageJson) {
		const repositoryPath =
			process.env.FORGE_DOCKER_NAMESPACE?.trim() ||
			workspacePackageJson.getRepositoryFullName() ||
			this.normalizeDockerRepository(projectName);
		const projectSlug = this.normalizeProjectSlug(projectName);
		if (repositoryPath.includes("/") && projectSlug !== "") {
			return `${this.#defaultRegistry}/${repositoryPath}/${projectSlug}`;
		}
		return `${this.#defaultRegistry}/${repositoryPath}`;
	}

	private normalizeDockerRepository(name: string) {
		const repository = name
			.replace(/^@/, "")
			.split("/")
			.map((segment) =>
				segment
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, "-")
					.replace(/^-+|-+$/g, ""),
			)
			.filter(Boolean)
			.join("/");

		if (repository === "") {
			throw new ForgeError(`Could not derive a Docker repository from project name "${name}"`);
		}

		return repository;
	}

	private normalizeProjectSlug(name: string) {
		const unscoped = name.includes("/") ? (name.split("/").at(-1) ?? name) : name;
		const slug = unscoped
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "");
		if (slug === "") {
			throw new ForgeError(
				`Could not derive a Docker project slug from project name "${name}"`,
			);
		}
		return slug;
	}

	private parseJsonEnv<T>(name: string, fallback: T): T {
		const value = process.env[name];
		if (value == null || value.trim() === "") {
			return fallback;
		}

		try {
			return JSON.parse(value) as T;
		} catch (reason) {
			throw new ForgeError(`Invalid JSON in ${name}: ${formatUnknownError(reason)}`);
		}
	}
}
