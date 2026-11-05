import { execSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { injectable } from "@decohere/crucible/decorators";
import type { HasPackageJson } from "@decohere/workspace";
import { Workspace } from "@decohere/workspace";
import type { Action, ResultStatus } from "@decohere/devkit/cli";
import { ActionResponse } from "@decohere/devkit/cli";
import { Git } from "@decohere/devkit/interop";
import { Semver, SemverError, type VersionType, VersionTypes } from "../semver/index.js";
import { scribe } from "@decohere/scribe";
import { ForgeError, formatUnknownError } from "../errors.js";

export type VersionResponse = ResultStatus & {
	name: string;
};

export const DefaultChannel = "beta";
export const DefaultReleaseType = VersionTypes.prerelease;

export type VersionOptions = {
	releaseType?: VersionType;
	channel?: string;
	version?: string;
	/** A CI run number: the version becomes `<base>-<channel>.<commit's UTC date>.<number>`. */
	buildNumber?: string;
	/** Copy the version from the built packages, failing if they don't all match. */
	fromBuild?: boolean;
	/** The build `fromBuild` reads. */
	configuration?: string;
	dryRun?: boolean;
	commit?: boolean;
	message?: string;
	/** Read pending .changeset entries to determine the highest bump type */
	fromChangesets?: boolean;
};

const DefaultVersionOptions: VersionOptions = {
	releaseType: DefaultReleaseType,
	channel: DefaultChannel,
	dryRun: false,
};

@injectable()
export class Version implements Action<VersionOptions> {
	#logger = scribe.logger(Version.name);
	public constructor(private readonly workspace: Workspace) {}
	public async run(options: VersionOptions): Promise<ActionResponse> {
		const response = await this.version(this.workspace, options);
		const messages = response.data
			.flatMap((d) => (!d.succeeded && d.error ? [d.error] : []))
			.join("\n");
		if (messages) {
			throw new ForgeError(`There was an error versioning the workspace ${messages}`);
		}

		return response;
	}

	public async version(
		workspace: Workspace,
		options: VersionOptions = DefaultVersionOptions,
	): Promise<ActionResponse<VersionResponse>> {
		const projects = workspace.getProjects("debug");
		const nextVersion = await this.resolveNextVersion(workspace, options);

		if (options.dryRun) {
			this.#logger.info(
				`[dry-run] Would bump all packages to ${nextVersion} — skipping file writes`,
			);
			return ActionResponse.Success(Version.name, [
				{ name: workspace.name, succeeded: true },
				...projects.map((p) => ({ name: p.name, succeeded: true })),
			]);
		}

		await workspace.persistPackageJson(
			(await workspace.getPackageJson()).withVersion(nextVersion.toString()),
		);

		// Standalone, the project's package.json is the root's: write it once.
		const projectsToWrite = workspace.isStandalone ? [] : projects;
		const responses = await Promise.all([
			this.updatePackageJson(workspace.name, workspace, nextVersion),
			...projectsToWrite.map((project) =>
				this.updatePackageJson(project.name, project, nextVersion),
			),
		]);
		const failed = responses.filter((r) => !r.succeeded);
		if (failed.length) {
			return ActionResponse.Error(Version.name, responses);
		}

		if (options.commit) {
			const files = [
				workspace.packageJsonPath,
				...projectsToWrite.map((p) => p.packageJsonPath),
			];
			const message = options.message ?? `chore: version packages ${nextVersion}`;
			this.#logger.info(`Committing: ${message}`);
			await new Git().commit(message, { files });
		}

		return ActionResponse.Success(Version.name, responses);
	}

	private async resolveNextVersion(
		workspace: Workspace,
		options: VersionOptions,
	): Promise<Semver> {
		if (options.buildNumber != null && options.fromBuild) {
			throw new ForgeError("Use --build-number or --from-build, not both");
		}
		if (options.buildNumber != null) {
			return await this.versionFromBuildNumber(workspace, options);
		}
		if (options.fromBuild) {
			return await this.versionFromBuild(workspace, options);
		}

		const rootVersion = await this.resolveBaseVersion(workspace, options);
		const releaseType = options.fromChangesets
			? await this.resolveReleaseTypeFromChangesets()
			: (options.releaseType ?? DefaultReleaseType);
		const channel = options.channel ?? DefaultChannel;
		const nextVersion = this.getNextVersion(rootVersion, releaseType, channel);
		this.#logger.info(`${rootVersion} → ${nextVersion} [${releaseType}]`);
		return nextVersion;
	}

	private async versionFromBuildNumber(
		workspace: Workspace,
		options: VersionOptions,
	): Promise<Semver> {
		const { buildNumber, channel = DefaultChannel } = options;
		if (buildNumber == null || !/^[1-9]\d*$/.test(buildNumber)) {
			throw new ForgeError(`--build-number must be a positive whole number: ${buildNumber}`);
		}
		const seconds = await new Git().getHeadCommitTime({ cwd: workspace.rootDir });
		const utcDay = new Date(seconds * 1000).toISOString().slice(0, 10).replaceAll("-", "");
		const nextVersion = new Semver(await workspace.getVersion()).withPrerelease(
			`${channel}.${utcDay}.${buildNumber}`,
		);
		this.#logger.info(`Version from build number: ${nextVersion}`);
		return nextVersion;
	}

	private async versionFromBuild(
		workspace: Workspace,
		options: VersionOptions,
	): Promise<Semver> {
		const projects = workspace.getProjects(options.configuration ?? "release");
		const built = await Promise.all(
			projects.map(async (project) => ({
				name: project.name,
				version: await this.readBuiltVersion(project.getOutDir(), project.name),
			})),
		);
		const versions = [...new Set(built.map((b) => b.version))];
		if (versions.length !== 1) {
			throw new ForgeError(
				`Built packages disagree on the version: ${built.map((b) => `${b.name}@${b.version}`).join(", ")}`,
			);
		}
		this.#logger.info(`Version from the build: ${versions[0]}`);
		return new Semver(versions[0]);
	}

	private async readBuiltVersion(outDir: string, name: string): Promise<string> {
		const file = join(outDir, "package.json");
		let text: string;
		try {
			text = await readFile(file, "utf8");
		} catch (reason) {
			throw new ForgeError(`No build for ${name} at ${file}: ${formatUnknownError(reason)}`);
		}
		const { version } = JSON.parse(text) as { version?: unknown };
		if (typeof version !== "string") {
			throw new ForgeError(`The build of ${name} has no version: ${file}`);
		}
		return version;
	}

	private async resolveBaseVersion(
		workspace: Workspace,
		options: VersionOptions,
	): Promise<string> {
		if (options.version != null && options.version.trim().length > 0) {
			return options.version.trim();
		}

		const gitTagVersion = this.resolveVersionFromGitTag();
		if (gitTagVersion != null) {
			this.#logger.info(`Using latest git tag version as base: ${gitTagVersion}`);
			return gitTagVersion;
		}

		const workspaceVersion = await workspace.getVersion();
		this.#logger.info(
			`No semver git tags found, falling back to workspace package.json version: ${workspaceVersion}`,
		);
		return workspaceVersion;
	}

	private resolveVersionFromGitTag(): string | undefined {
		try {
			const tags = execSync('git tag --list "v*" --sort=-version:refname', {
				encoding: "utf8",
			})
				.trim()
				.split("\n")
				.filter(Boolean);

			if (tags.length === 0) {
				return undefined;
			}

			return tags[0].replace(/^v/, "");
		} catch {
			return undefined;
		}
	}

	/**
	 * Reads all pending .changeset/*.md entries and returns the highest bump type
	 * found across all of them. Precedence: major > minor > patch.
	 */
	private async resolveReleaseTypeFromChangesets(): Promise<VersionType> {
		const changesetDir = join(process.cwd(), ".changeset");
		let entries: string[];
		try {
			entries = await readdir(changesetDir);
		} catch {
			throw new ForgeError(
				"No .changeset directory found. Run `pnpm changeset` to create an entry.",
			);
		}

		const files = entries.filter((e) => e.endsWith(".md") && e !== "README.md");
		if (files.length === 0) {
			throw new ForgeError(
				"No pending changeset entries found in .changeset/. Run `pnpm changeset` to create one.",
			);
		}

		const precedence: Record<string, number> = { major: 3, minor: 2, patch: 1, prerelease: 0 };
		let maxType: VersionType = VersionTypes.patch;
		let maxPrecedence = 0;

		for (const file of files) {
			const content = await readFile(join(changesetDir, file), "utf8");
			const match = content.match(/^---\n([\s\S]*?)\n---/);
			if (!match) continue;
			for (const line of match[1].split("\n")) {
				const bumpType = line.match(/^"[^"]+"\s*:\s*(\w+)/)?.[1] as VersionType | undefined;
				const p = bumpType != null ? (precedence[bumpType] ?? -1) : -1;
				if (p > maxPrecedence) {
					maxType = bumpType as VersionType;
					maxPrecedence = p;
				}
			}
		}

		this.#logger.info(`Resolved release type from ${files.length} changeset(s): ${maxType}`);
		return maxType;
	}

	private getNextVersion(
		currentVersion: string,
		versionType: VersionType,
		preid: string,
	): Semver {
		try {
			return new Semver(currentVersion).increment(versionType, preid);
		} catch (error) {
			if (error instanceof SemverError) {
				throw new ForgeError(error.message);
			}

			throw error;
		}
	}

	private async updatePackageJson(
		name: string,
		hasJson: HasPackageJson,
		version: Semver,
	): Promise<VersionResponse> {
		try {
			const packageJson = await hasJson.getPackageJson();
			await hasJson.persistPackageJson(packageJson.withVersion(version.toString()));
			this.#logger.trace(name);
			return {
				name,
				succeeded: true,
			};
		} catch (reason) {
			return {
				name,
				succeeded: false,
				error: `${name}: ${formatUnknownError(reason)}`,
			};
		}
	}
}
