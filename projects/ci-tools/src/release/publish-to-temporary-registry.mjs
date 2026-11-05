#!/usr/bin/env node
/**
 * Publishes every public @decohere package in a build folder to CI's temporary registry, named by
 * DECOHERE_E2E_REGISTRY. Plain `npm publish`: `forge publish` ignores the user's npm config on
 * purpose, so that a real publish can't pick up stray credentials. npm refuses to publish without
 * a login, so this gives it a made-up one; the registry takes anything.
 *
 * Usage: publish-to-temporary-registry.mjs <build folder>
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * @param {string} dir
 * @returns {string[]} folders of public @decohere packages
 */
export function findPublicPackages(dir) {
	const found = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules") continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			found.push(...findPublicPackages(path));
		} else if (entry.name === "package.json") {
			const pkg = JSON.parse(readFileSync(path, "utf8"));
			if (pkg.name?.startsWith("@decohere/") && pkg.private !== true) found.push(dir);
		}
	}
	return found;
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const registry = process.env.DECOHERE_E2E_REGISTRY;
	if (!registry) {
		console.error("DECOHERE_E2E_REGISTRY is required");
		process.exit(1);
	}
	const { host } = new URL(registry);
	const userConfig = join(mkdtempSync(join(tmpdir(), "temporary-registry-")), ".npmrc");
	writeFileSync(userConfig, `registry=${registry}\n//${host}/:_authToken=made-up\n`);

	const packages = findPublicPackages(resolve(process.argv[2] ?? "dist/release"));
	if (packages.length === 0) {
		console.error("No public @decohere packages found");
		process.exit(1);
	}
	for (const dir of packages) {
		const result = spawnSync("npm", ["publish", dir, "--tag", "dev"], {
			stdio: ["ignore", "inherit", "inherit"],
			env: {
				...process.env,
				NPM_CONFIG_REGISTRY: registry,
				NPM_CONFIG_USERCONFIG: userConfig,
			},
		});
		if (result.status !== 0) {
			console.error(`Publishing ${dir} failed`);
			process.exit(result.status ?? 1);
		}
	}
	console.log(`Published ${packages.length} packages`);
}
