import path from "node:path";
import { InteropError } from "../errors/interop.error.js";
import { Shell } from "../shell/shell.js";
import type { PackageManager } from "../types/package-manager.js";
import type { NpmOptions, PublishOptions, VersionOptions, VersionType } from "./npm.types.js";

const Commands = {
	publish: "publish",
	version: "version",
	link: "link",
	install: "install",
};

export class Npm extends Shell implements PackageManager {
	public readonly name = "npm" as const;
	protected program: string = "npm";

	/**
	 * A folder as npm reads it: a relative `dist/release` looks like the GitHub repository
	 * `dist/release` to npm, so it gets a leading `./`.
	 */
	private static folderSpec(directory: string): string {
		if (path.isAbsolute(directory) || /^\.\.?([/\\]|$)/.test(directory)) return directory;
		return `./${directory}`;
	}

	public async publish(directory: string, options: PublishOptions = { channel: "beta" }) {
		const { cwd, dryRun, skipIfPublished, channel, authToken, otp, provenance } = options;
		if (directory == null) {
			throw new InteropError("Directory is required");
		}

		if (skipIfPublished && !dryRun) {
			const alreadyPublished = await this.isPublished(directory, { cwd });
			if (alreadyPublished) {
				return { message: `Skipping publish — version already exists on registry`, data: [] };
			}
		}

		const args = [Commands.publish, Npm.folderSpec(directory)];
		let tmpUserConfigPath: string | undefined;

		args.push("--tag", channel ?? "beta");

		if (provenance) {
			args.push("--provenance");
		}

		// Explicit --token (local bootstrap). OIDC publish must not inherit cwd .npmrc / NODE_AUTH_TOKEN.
		if (authToken?.trim()) {
			tmpUserConfigPath = await this.createTempUserConfig(authToken.trim());
			args.push("--userconfig", tmpUserConfigPath);
		}

		if (dryRun) {
			args.push("--dry-run");
		}

		const env = { ...process.env };
		if (!authToken?.trim()) {
			delete env.NODE_AUTH_TOKEN;
			delete env.NPM_TOKEN;
			env.NPM_CONFIG_USERCONFIG = "/dev/null";
		}
		if (otp) {
			env.NPM_CONFIG_OTP = otp;
		}

		try {
			return await this.run({ cwd, env }, ...args);
		} catch (error) {
			if (skipIfPublished && !dryRun && isAlreadyPublishedError(error)) {
				return { message: `Skipping publish — version already exists on registry`, data: [] };
			}
			throw error;
		} finally {
			if (tmpUserConfigPath) {
				await this.removeTempUserConfig(tmpUserConfigPath);
			}
		}
	}

	/**
	 * @description Runs in the directory of the package
	 * @param options
	 * @returns
	 */
	public async version(versionType: VersionType, options: VersionOptions) {
		const { cwd, noTag, preid } = options;
		const args = [Commands.version, versionType];
		if (noTag) {
			args.push("--no-git-tag-version");
		}

		if (preid) {
			args.push("--preid", preid);
		}

		return this.run({ cwd }, ...args);
	}

	public async link(directory: string, options: NpmOptions = { cwd: "./" }) {
		const { cwd } = options;
		const args = [Commands.link, directory];
		return this.run({ cwd }, ...args);
	}

	public async install(options: NpmOptions = { cwd: "./" }) {
		const { cwd } = options;
		return this.run({ cwd }, Commands.install);
	}

	/**
	 * Install only `dependencies` as real folders: `--omit=dev` skips devDependencies and
	 * `--no-bin-links` skips the `.bin` symlinks, so the result holds no symlinks at all.
	 */
	public async installProduction(options: NpmOptions = { cwd: "./" }) {
		const { cwd } = options;
		return this.run(
			{ cwd },
			Commands.install,
			"--omit=dev",
			"--no-bin-links",
			"--no-audit",
			"--no-fund",
			"--loglevel=error",
		);
	}

	public async syncLockFile(options: NpmOptions = { cwd: "./" }) {
		const { cwd } = options;
		return this.run({ cwd }, Commands.install, "--package-lock-only", "--ignore-scripts");
	}

	/**
	 * True when package@version exists on the registry.
	 * Uses ambient npm config (cwd `.npmrc`); do not pass tokens on argv.
	 */
	private async isPublished(directory: string, options: NpmOptions): Promise<boolean> {
		const { readFileSync } = await import("node:fs");
		const { join } = await import("node:path");
		try {
			const pkgJson = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
			const spec = `${pkgJson.name}@${pkgJson.version}`;
			await this.run(options, "view", spec, "version");
			return true;
		} catch {
			return false;
		}
	}

	private async createTempUserConfig(authToken: string): Promise<string> {
		const { mkdtemp, writeFile } = await import("node:fs/promises");
		const { tmpdir } = await import("node:os");
		const { join } = await import("node:path");
		const tempDir = await mkdtemp(join(tmpdir(), "decohere-npmrc-"));
		const npmrcPath = join(tempDir, ".npmrc");
		const npmrc = [
			"registry=https://registry.npmjs.org/",
			"always-auth=true",
			`//registry.npmjs.org/:_authToken=${authToken}`,
		].join("\n");
		await writeFile(npmrcPath, `${npmrc}\n`, { mode: 0o600 });
		return npmrcPath;
	}

	private async removeTempUserConfig(npmrcPath: string): Promise<void> {
		const { rm } = await import("node:fs/promises");
		const { dirname } = await import("node:path");
		const dir = dirname(npmrcPath);
		await rm(dir, { recursive: true, force: true });
	}
}

function isAlreadyPublishedError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /cannot publish over the previously published versions/i.test(message);
}
