import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { resolveLaunch } from "./resolve-launch.js";
import { CREATE_IMAGE_REPOSITORY, CREATE_VERSION } from "./version.js";

const BUILDER_IMAGE = `${CREATE_IMAGE_REPOSITORY}:${CREATE_VERSION}`;

/**
 * Pull/run the Decohere scaffolder image. Host `@decohere/create` does not load
 * the `@decohere/scaffold` dependency tree — that lives in the image only.
 */
export function runInBuilder(argv: string[]): never {
	const { targetDir, containerArgv, projectName, kind } = resolveLaunch(argv);
	mkdirSync(targetDir, { recursive: true });
	if (kind === "scaffold") {
		mkdirSync(resolve(targetDir, ".devcontainer", "npm-auth"), { recursive: true });
	}

	try {
		execFileSync("docker", ["info"], { stdio: "pipe" });
	} catch {
		console.error(
			"\n  Docker is required to scaffold a Decohere project.\n" +
				"  Install Docker Desktop: https://www.docker.com/products/docker-desktop\n",
		);
		process.exit(1);
	}

	const hostUid = process.getuid?.();
	const hostGid = process.getgid?.() ?? hostUid;
	const runAsHostUser = hostUid != null && hostGid != null;

	const npmCacheDir = resolve(homedir(), ".cache/decohere-create/npm");
	mkdirSync(npmCacheDir, { recursive: true });

	const builderHome = "/tmp/decohere-create-home";

	const volumes: string[] = [
		"-v",
		`${targetDir}:/workspace`,
		"-v",
		`${npmCacheDir}:/npm-cache`,
	];

	const envArgs: string[] = [
		"-e",
		"DECOHERE_BUILDER=1",
		"-e",
		`DECOHERE_PROJECT_NAME=${projectName}`,
		"-e",
		"NPM_CONFIG_CACHE=/npm-cache",
		"-e",
		"NPM_CONFIG_PREFER_OFFLINE=true",
		"-e",
		`HOME=${builderHome}`,
	];

	const npmrcPath = resolve(homedir(), ".npmrc");
	if (existsSync(npmrcPath)) {
		volumes.push("-v", `${npmrcPath}:/tmp/host-npmrc:ro`);
		envArgs.push("-e", "NPM_CONFIG_USERCONFIG=/tmp/host-npmrc");
	}

	const auth0ConfigDir = resolve(homedir(), ".config/auth0");
	mkdirSync(auth0ConfigDir, { recursive: true });
	volumes.push("-v", `${auth0ConfigDir}:${builderHome}/.config/auth0`);

	const userArgs: string[] = [];
	if (runAsHostUser) {
		userArgs.push("--user", `${hostUid}:${hostGid}`);
	} else if (hostUid != null) {
		envArgs.push("-e", `HOST_UID=${hostUid}`);
		if (hostGid != null) envArgs.push("-e", `HOST_GID=${hostGid}`);
	}

	console.log(
		kind === "auth0"
			? "  Running Auth0 CLI in the scaffolder image...\n"
			: "  Running scaffolding in a sandboxed container...\n",
	);

	const ttyFlags = process.stdin.isTTY ? ["-it"] : ["-i"];

	const result = spawnSync(
		"docker",
		[
			"run",
			"--rm",
			...ttyFlags,
			...userArgs,
			...volumes,
			...envArgs,
			"-w",
			"/workspace",
			BUILDER_IMAGE,
			...containerArgv,
		],
		{ stdio: "inherit" },
	);

	if (result.status === 0 && kind === "scaffold") {
		console.log(`\n  Scaffold complete!\n\n  Open your project:\n\n    code ${targetDir}\n`);
	}

	process.exit(result.status ?? 0);
}
