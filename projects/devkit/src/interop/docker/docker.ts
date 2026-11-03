import { InteropError } from "../errors/interop.error.js";
import { Shell } from "../shell/shell.js";

export type DockerBuildOptions = {
	cwd?: string;
	dockerfile?: string;
	tags?: string[];
	buildArgs?: Record<string, string>;
	secrets?: Record<string, string>;
	noCache?: boolean;
	pull?: boolean;
};

export type DockerPushOptions = {
	cwd?: string;
};

export class Docker extends Shell {
	public readonly name = "docker" as const;
	protected program = "docker";

	public async build(contextDir: string, options: DockerBuildOptions = {}) {
		if (contextDir == null || contextDir.trim() === "") {
			throw new InteropError("Docker build context is required");
		}

		const args = ["build"];
		if (options.dockerfile) {
			args.push("-f", options.dockerfile);
		}
		for (const tag of options.tags ?? []) {
			args.push("-t", tag);
		}
		for (const [key, value] of Object.entries(options.buildArgs ?? {})) {
			args.push("--build-arg", `${key}=${value}`);
		}
		for (const [id, env] of Object.entries(options.secrets ?? {})) {
			args.push("--secret", `id=${id},env=${env}`);
		}
		if (options.noCache) {
			args.push("--no-cache");
		}
		if (options.pull) {
			args.push("--pull");
		}
		args.push(contextDir);
		return await this.run({ cwd: options.cwd }, ...args);
	}

	public async push(tag: string, options: DockerPushOptions = {}) {
		if (tag == null || tag.trim() === "") {
			throw new InteropError("Docker tag is required");
		}

		return await this.run({ cwd: options.cwd }, "push", tag);
	}
}
