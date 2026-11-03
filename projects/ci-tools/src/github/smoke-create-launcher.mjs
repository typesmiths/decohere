#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Run `npx @decohere/create@version --help` from an empty temp directory.
 * Must not use the repo cwd — after `@decohere/cli` is pinned, pnpm installs
 * `@decohere/create` into the workspace tree and npm's npx misses the bin.
 *
 * @param {{
 *   createVersion: string,
 *   authToken: string,
 *   mkdtempSync?: typeof mkdtempSync,
 *   writeFileSync?: typeof writeFileSync,
 *   spawnSync?: typeof spawnSync,
 *   tmpdir?: () => string,
 *   stdio?: import("node:child_process").StdioOptions,
 * }} options
 */
export function runCreateLauncherSmoke(options) {
	const version = options.createVersion?.trim() ?? "";
	const token = options.authToken?.trim() ?? "";
	if (!version) {
		throw new Error("CREATE_VERSION is required");
	}
	if (!token) {
		throw new Error("NODE_AUTH_TOKEN is required");
	}

	const mkdtemp = options.mkdtempSync ?? mkdtempSync;
	const writeFile = options.writeFileSync ?? writeFileSync;
	const spawn = options.spawnSync ?? spawnSync;
	const tmp = options.tmpdir ?? tmpdir;

	const workDir = mkdtemp(join(tmp(), "decohere-create-smoke-"));
	const npmrc = join(workDir, ".npmrc");
	writeFile(
		npmrc,
		`@decohere:registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=${token}\n`,
	);

	const result = spawn("npx", ["--yes", `@decohere/create@${version}`, "--help"], {
		cwd: workDir,
		env: {
			...process.env,
			NPM_CONFIG_USERCONFIG: npmrc,
			NODE_AUTH_TOKEN: token,
		},
		stdio: options.stdio ?? "inherit",
	});

	return {
		workDir,
		status: result.status ?? 1,
	};
}

const isCli =
	process.argv[1] != null && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isCli) {
	const { status } = runCreateLauncherSmoke({
		createVersion: process.env.CREATE_VERSION ?? "",
		authToken: process.env.NODE_AUTH_TOKEN ?? "",
	});
	process.exit(status);
}
