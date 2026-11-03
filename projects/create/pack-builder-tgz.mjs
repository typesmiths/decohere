#!/usr/bin/env node
/**
 * Vendor `@decohere/scaffold` for the builder image: resolve `@decohere/*` from
 * dist/release via `file:` (not `overrides`), `npm install --install-links`,
 * then tar the installed tree including `node_modules`. `--install-links`
 * materializes `file:` packages (and their deps) instead of leaving symlinks
 * whose nested installs live outside the packed directory.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {{ name: string, dir: string }} WorkspacePackage
 */

/**
 * @param {string} rootDir
 * @returns {WorkspacePackage[]}
 */
export function collectWorkspacePackages(rootDir) {
	/** @type {WorkspacePackage[]} */
	const found = [];
	const walk = (dir) => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (entry.name === "node_modules" || entry.name === ".git") continue;
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(path);
				continue;
			}
			if (entry.name !== "package.json") continue;
			const pkg = JSON.parse(readFileSync(path, "utf8"));
			if (typeof pkg.name === "string" && pkg.name.startsWith("@decohere/")) {
				found.push({ name: pkg.name, dir });
			}
		}
	};
	walk(rootDir);
	return found;
}

/**
 * @param {string} fromDir
 * @param {string} pkgDir
 */
export function fileSpec(fromDir, pkgDir) {
	let rel = relative(fromDir, pkgDir) || ".";
	rel = rel.replaceAll("\\", "/");
	if (!rel.startsWith(".")) rel = `./${rel}`;
	return `file:${rel}`;
}

/**
 * Rewrite `@decohere/*` dependency specs to local `file:` paths.
 * Must mutate `dependencies` (not `overrides`) — npm throws EOVERRIDE when an
 * override conflicts with a direct dependency.
 *
 * @param {Record<string, unknown>} pkg
 * @param {string} fromDir
 * @param {WorkspacePackage[]} packages
 */
export function rewriteDecohereDepsToFile(pkg, fromDir, packages) {
	const byName = new Map(packages.map((item) => [item.name, item.dir]));
	const from = resolve(fromDir);
	const rewrite = (deps) => {
		if (deps == null || typeof deps !== "object" || Array.isArray(deps)) return deps;
		const next = { .../** @type {Record<string, unknown>} */ (deps) };
		for (const name of Object.keys(next)) {
			const dir = byName.get(name);
			if (dir == null || resolve(dir) === from) continue;
			next[name] = fileSpec(fromDir, dir);
		}
		return next;
	};
	return {
		...pkg,
		dependencies: rewrite(pkg.dependencies),
		optionalDependencies: rewrite(pkg.optionalDependencies),
	};
}

function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function runNpm(cwd, args) {
	const result = spawnSync("npm", args, { cwd, encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(
			`npm ${args.join(" ")} failed (exit ${result.status}):\n${result.stderr}${result.stdout}`,
		);
	}
	return result.stdout.trim();
}

function packInstalledTree(outDir, dest) {
	const result = spawnSync(
		"tar",
		["--create", "--gzip", "--dereference", "--file", dest, "-C", outDir, "."],
		{ encoding: "utf8" },
	);
	if (result.status !== 0) {
		throw new Error(`tar failed (exit ${result.status}):\n${result.stderr}${result.stdout}`);
	}
}

export function packBuilderTgz(options) {
	const outDir = resolve(options.outDir);
	const workspaceOut = resolve(options.workspaceOut);
	const dest = resolve(options.dest);
	const packageJsonPath = join(outDir, "package.json");
	const packages = collectWorkspacePackages(workspaceOut);
	const originals = packages.map((pkg) => {
		const path = join(pkg.dir, "package.json");
		return { path, original: JSON.parse(readFileSync(path, "utf8")) };
	});
	const createOriginal = originals.find((entry) => entry.path === packageJsonPath)?.original;
	if (createOriginal == null) {
		throw new Error(`No @decohere package.json at ${packageJsonPath}`);
	}

	try {
		for (const { path, original } of originals) {
			writeJson(path, rewriteDecohereDepsToFile(original, dirname(path), packages));
		}
		runNpm(outDir, ["install", "--omit=dev", "--ignore-scripts", "--install-links"]);
	} finally {
		for (const { path, original } of originals) {
			writeJson(path, original);
		}
	}

	packInstalledTree(outDir, dest);
	return dest;
}

function parseArgs(argv) {
	/** @type {Record<string, string>} */
	const parsed = {};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg == null || !arg.startsWith("--")) continue;
		const key = arg.slice(2);
		const value = argv[i + 1];
		if (value == null || value.startsWith("--")) {
			throw new Error(`Missing value for --${key}`);
		}
		parsed[key] = value;
		i++;
	}
	return parsed;
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const outDir = args["out-dir"];
	const workspaceOut = args["workspace-out"];
	const dest = args.dest;
	if (outDir == null || workspaceOut == null || dest == null) {
		throw new Error(
			"Usage: pack-builder-tgz.mjs --out-dir <dir> --workspace-out <dir> --dest <create.tgz>",
		);
	}
	packBuilderTgz({ outDir, workspaceOut, dest });
}

if (process.argv[1] != null && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main();
}
