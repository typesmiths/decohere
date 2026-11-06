import { injectable } from "@decohere/crucible/decorators";
import type { Project } from "@decohere/workspace";
import { Workspace } from "@decohere/workspace";
import type { Action, ResultStatus } from "@decohere/devkit/cli";
import { ActionResponse } from "@decohere/devkit/cli";
import { Npm } from "@decohere/devkit/interop";
import { scribe } from "@decohere/scribe";
import { ForgeError, formatUnknownError } from "../errors.js";
import { missingEntryPoints } from "../packaging/manifest-entry-points.js";

export type PublishOptions = {
	configuration: string;
	channel?: string;
	dryRun?: boolean;
	token?: string;
	otp?: string;
	promptAuth?: boolean;
	promptOtp?: boolean;
};

export type PublishResponse = ResultStatus & {
	projectName: string;
	message: string;
	packageName?: string;
};

@injectable()
export class Publish implements Action<PublishOptions> {
	// TODO: probably best to inject npm
	private readonly npm = new Npm();
	#logger = scribe.logger(Publish.name);

	public constructor(private readonly workspace: Workspace) {}

	public async run(options: PublishOptions): Promise<ActionResponse<PublishResponse>> {
		const projects = this.workspace.getProjects(options.configuration);
		this.assertEntryPointsExist(projects);
		const token = await this.resolveToken(options);
		const otp = await this.resolveOtp(options);

		if (projects.length === 0) {
			throw new ForgeError(`No projects found to publish`);
		}
		const publishResponses = await this.publishProjects(projects, {
			...options,
			token,
			otp,
		});
		const failed = publishResponses.filter((r) => !r.succeeded);
		if (failed.length) {
			return ActionResponse.Error(Publish.name, publishResponses);
		}
		return ActionResponse.Success(Publish.name, publishResponses);
	}

	/** All or nothing: one bad package stops the run before any package is published. */
	private assertEntryPointsExist(projects: readonly Project[]) {
		const problems = projects
			.filter((project) => !project.isPrivate)
			.flatMap((project) => {
				const { name, missing } = missingEntryPoints(project.getOutDir());
				return missing.map((file) => `  ${name ?? project.name}: ${file}`);
			});
		if (problems.length > 0) {
			throw new ForgeError(
				`These package.json entries point at files the build doesn't contain, so nothing was published:\n${problems.join("\n")}\nFix the paths, or run: forge build --configuration release`,
			);
		}
	}

	public async publishProjects(projects: readonly Project[], options: PublishOptions) {
		return await Promise.all(
			projects
				.filter((project) => {
					if (project.isPrivate) {
						this.#logger.info(`Skipping private package: ${project.name}`);
						return false;
					}
					return true;
				})
				.map(async (project) => await this.publishProject(project, options)),
		);
	}

	private async publishProject(
		project: Project,
		options: PublishOptions,
	): Promise<PublishResponse> {
		const { channel, dryRun, token, otp } = options;
		const outDir = project.getOutDir();
		this.#logger.info(`${dryRun ? "[dry-run] " : ""}Publishing ${project.name}`);

		try {
			const response = await this.npm.publish(outDir, {
				channel,
				dryRun,
				authToken: token,
				otp,
				skipIfPublished: true,
			});

			const packageName = response.data?.join("");
			this.#logger.trace(`${project.name} → ${packageName ?? response.message}`);
			return {
				projectName: project.name,
				succeeded: true,
				message: response.message,
				packageName,
			};
		} catch (reason) {
			const message = formatUnknownError(reason);
			return {
				projectName: project.name,
				succeeded: false,
				message,
				error: `${project.name}: ${message}`,
			};
		}
	}

	private async resolveToken(options: PublishOptions): Promise<string | undefined> {
		if (options.token?.trim()) {
			return options.token.trim();
		}

		if (options.promptAuth) {
			return await this.promptSecret("npm access token: ");
		}

		return undefined;
	}

	private async resolveOtp(options: PublishOptions): Promise<string | undefined> {
		if (options.otp?.trim()) {
			return options.otp.trim();
		}

		if (options.promptAuth || options.promptOtp) {
			return await this.promptSecret("npm OTP: ");
		}

		return undefined;
	}

	private async promptSecret(label: string): Promise<string | undefined> {
		if (!process.stdin.isTTY || !process.stdout.isTTY) {
			throw new ForgeError(`Cannot prompt for secret without an interactive TTY`);
		}

		process.stdout.write(label);
		const stdin = process.stdin;
		stdin.setEncoding("utf8");
		stdin.resume();
		stdin.setRawMode?.(true);

		let value = "";

		return await new Promise<string>((resolve, reject) => {
			const cleanup = () => {
				stdin.setRawMode?.(false);
				stdin.pause();
				stdin.removeListener("data", onData);
				process.stdout.write("\n");
			};

			const onData = (chunk: string) => {
				const char = chunk;
				if (char === "\u0003") {
					cleanup();
					reject(new ForgeError("Input cancelled"));
					return;
				}

				if (char === "\r" || char === "\n") {
					cleanup();
					resolve(value.trim());
					return;
				}

				if (char === "\u0008" || char === "\u007f") {
					value = value.slice(0, -1);
					return;
				}

				value += char;
			};

			stdin.on("data", onData);
		});
	}
}
