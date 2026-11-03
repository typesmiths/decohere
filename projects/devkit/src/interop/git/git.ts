import { InteropError } from "../errors/interop.error.js";
import { Shell } from "../shell/shell.js";
import type { ShellResponse } from "../shell/shell.types.js";
import type { CommitOptions, GitOptions, PushOptions, StageOptions } from "./git.types.js";

const Commands = {
	stage: "stage",
	tag: "tag",
	add: "add",
	commit: "commit",
	push: "push",
	listFiles: "ls-files",
};

const defaultOptions: GitOptions = { cwd: "./" };

export class Git extends Shell {
	protected program: string = "git";
	public async getModifiedFiles(options: GitOptions = defaultOptions) {
		const args = [Commands.listFiles, "--modified"];
		const { cwd } = options;
		const result = await this.run({ cwd }, ...args);
		return result.data;
	}

	public async getBranchName(options: GitOptions = defaultOptions) {
		const { cwd } = options;
		const args = ["rev-parse", "--symbolic-full-name", "--abbrev-ref", "HEAD"];
		const result = await this.run({ cwd }, ...args);
		return result.data[0];
	}

	public async tag(tag: string, options: GitOptions = defaultOptions) {
		const args = [Commands.tag, tag];
		const { cwd } = options;
		const result = await this.run({ cwd }, ...args);
		return result;
	}

	public async pushTag(
		tag: string,
		options: GitOptions & { remote?: string } = defaultOptions,
	) {
		const { cwd, remote = "origin" } = options;
		const result = await this.run({ cwd }, Commands.push, remote, tag);
		return result;
	}

	public async commit(message: string, options: CommitOptions): Promise<ShellResponse> {
		const optionsAndDefaults = { ...defaultOptions, ...options };
		const { cwd, files = [], all } = optionsAndDefaults;
		const args = [Commands.commit];

		if (files.length > 0 && all) {
			throw new InteropError("Cannot commit all and files at the same time");
		}

		if (files.length > 0) {
			await this.stage({ files });
		}

		if (options.all) {
			args.push("-a");
		}

		args.push("-m", message);
		const result = await this.run({ cwd }, ...args);
		return result;
	}

	public async push(branch: string, options?: PushOptions) {
		const optionsAndDefaults = { ...defaultOptions, ...options };
		const { cwd, setUpstream } = optionsAndDefaults;
		const args = [Commands.push];
		args.push("--set-upstream", setUpstream ?? "origin");
		args.push(branch);
		const result = await this.run({ cwd }, ...args);
		return result;
	}

	public async pull(branch: string, options: GitOptions = defaultOptions) {
		const { cwd } = options;
		return this.run({ cwd }, "pull", "--rebase", "origin", branch);
	}

	public async stage(options: StageOptions) {
		const optionsAndDefaults = { ...defaultOptions, ...options };
		const { cwd, files = [], all } = optionsAndDefaults;
		if (all) {
			await this.run({ cwd }, Commands.stage, "-a");
			return;
		}

		for (const file of files) {
			await this.run({ cwd }, Commands.stage, file);
		}
	}
}
