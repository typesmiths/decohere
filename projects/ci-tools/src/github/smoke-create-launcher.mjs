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
 * No token: the packages are public, so this installs the launcher the way a user does.
 * Anonymous reads go through npm's cache, which can lag minutes behind a publish, so it
 * first waits until npm serves the version (`attempts` tries, `intervalMs` apart).
 *
 * @param {{
 *   createVersion: string,
 *   attempts?: number,
 *   intervalMs?: number,
 *   sleep?: (ms: number) => void,
 *   mkdtempSync?: typeof mkdtempSync,
 *   writeFileSync?: typeof writeFileSync,
 *   spawnSync?: typeof spawnSync,
 *   tmpdir?: () => string,
 *   stdio?: import("node:child_process").StdioOptions,
 * }} options
 */
export function runCreateLauncherSmoke(options) {
	const version = options.createVersion?.trim() ?? "";
	if (!version) {
		throw new Error("CREATE_VERSION is required");
	}

	const mkdtemp = options.mkdtempSync ?? mkdtempSync;
	const writeFile = options.writeFileSync ?? writeFileSync;
	const spawn = options.spawnSync ?? spawnSync;
	const tmp = options.tmpdir ?? tmpdir;
	const sleep = options.sleep ?? sleepSync;
	const attempts = options.attempts ?? 20;
	const intervalMs = options.intervalMs ?? 15_000;

	const workDir = mkdtemp(join(tmp(), "decohere-create-smoke-"));
	const npmrc = join(workDir, ".npmrc");
	writeFile(npmrc, "@decohere:registry=https://registry.npmjs.org/\n");

	const env = { ...process.env, NPM_CONFIG_USERCONFIG: npmrc };
	const spec = `@decohere/create@${version}`;

	for (let attempt = 1; ; attempt++) {
		const view = spawn("npm", ["view", spec, "version"], { cwd: workDir, env, stdio: "pipe" });
		if (view.status === 0) break;
		if (attempt >= attempts) {
			console.error(`${spec} is still not served by npm after ${attempts} tries`);
			return { workDir, status: 1 };
		}
		console.log(`${spec} not served by npm yet (try ${attempt} of ${attempts}); waiting`);
		sleep(intervalMs);
	}

	const result = spawn("npx", ["--yes", spec, "--help"], {
		cwd: workDir,
		env,
		stdio: options.stdio ?? "inherit",
	});

	return {
		workDir,
		status: result.status ?? 1,
	};
}

/** @param {number} ms */
function sleepSync(ms) {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const isCli =
	process.argv[1] != null && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isCli) {
	const { status } = runCreateLauncherSmoke({
		createVersion: process.env.CREATE_VERSION ?? "",
	});
	process.exit(status);
}
