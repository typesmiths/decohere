import fs from "node:fs/promises";
import path from "node:path";
import semver from "semver";
import { parse as parseYaml } from "yaml";
import { io } from "@decohere/core/io";
import { ForgeError } from "../errors.js";
import { type FileDiff, unifiedDiff, UnifiedDiffError } from "./unified-diff.js";

/** One `patchedDependencies` entry from the workspace root. */
export type PnpmPatch = {
	/** The key as written: `name`, `name@1.2.3` or `name@^1.2.0`. */
	key: string;
	name: string;
	/** The version or range after the name; undefined when the key is the bare name. */
	spec: string | undefined;
	exact: boolean;
	/** The patch file as written, relative to the workspace root. */
	file: string;
};

export type PatchReport = {
	applied: { name: string; version: string; file: string }[];
	skipped: PnpmPatch[];
};

type InstalledPackage = { name: string; version: string; dir: string };

/**
 * The workspace's pnpm patches: `pnpm.patchedDependencies` and top-level `patchedDependencies`
 * in the root package.json, and `patchedDependencies` in `pnpm-workspace.yaml` (where pnpm 10
 * keeps its settings). One key naming two different files is an error.
 */
async function read(rootDir: string): Promise<PnpmPatch[]> {
	const sources: [string, unknown][] = [];
	const manifestPath = path.join(rootDir, "package.json");
	if (await io.fileExists(manifestPath)) {
		const manifest = await io.readJsonFile<{
			pnpm?: { patchedDependencies?: unknown };
			patchedDependencies?: unknown;
		}>(manifestPath);
		sources.push([
			"package.json pnpm.patchedDependencies",
			manifest.pnpm?.patchedDependencies,
		]);
		sources.push(["package.json patchedDependencies", manifest.patchedDependencies]);
	}
	const workspaceYamlPath = path.join(rootDir, "pnpm-workspace.yaml");
	if (await io.fileExists(workspaceYamlPath)) {
		const settings: unknown = parseYaml(await fs.readFile(workspaceYamlPath, "utf8"));
		const patched = isRecord(settings) ? settings.patchedDependencies : undefined;
		sources.push(["pnpm-workspace.yaml patchedDependencies", patched]);
	}

	const byKey = new Map<string, PnpmPatch>();
	for (const [where, entries] of sources) {
		if (entries == null) {
			continue;
		}
		if (!isRecord(entries)) {
			throw new ForgeError(`${where} must map package names to patch files.`);
		}
		for (const [key, file] of Object.entries(entries)) {
			if (typeof file !== "string" || file === "") {
				throw new ForgeError(`${where} "${key}" must name a patch file.`);
			}
			const known = byKey.get(key);
			if (known != null && known.file !== file) {
				throw new ForgeError(
					`The patch for ${key} is set twice, to ${known.file} and to ${file} (${where}). Keep one.`,
				);
			}
			byKey.set(key, { ...parseKey(key, where), file });
		}
	}
	return [...byKey.values()];
}

function parseKey(key: string, where: string): Omit<PnpmPatch, "file"> {
	const at = key.indexOf("@", 1);
	if (at === -1) {
		return { key, name: key, spec: undefined, exact: false };
	}
	const name = key.slice(0, at);
	const spec = key.slice(at + 1);
	if (semver.valid(spec) != null) {
		return { key, name, spec, exact: true };
	}
	if (semver.validRange(spec) != null) {
		return { key, name, spec, exact: false };
	}
	throw new ForgeError(
		`${where} "${key}": "${spec}" is not a version or a version range of ${name}.`,
	);
}

/**
 * Applies the patches to every installed copy of their package under `packageDir/node_modules`,
 * as pnpm does: for each copy, the patch keyed to its exact version wins, then one whose range
 * it satisfies, then one keyed by the bare name. A patch keyed to a version or range no copy
 * has is an error, and so is a hunk that doesn't apply. Every patch is checked against every
 * file before anything is written, so a failure leaves no package half patched.
 */
async function apply(
	patches: readonly PnpmPatch[],
	rootDir: string,
	packageDir: string,
	shipper: string,
): Promise<PatchReport> {
	const report: PatchReport = { applied: [], skipped: [] };
	if (patches.length === 0) {
		return report;
	}

	const installed = await installedPackages(path.join(packageDir, "node_modules"));
	const writes = new Map<string, string | null>();
	const diffs = new Map<string, FileDiff[]>();

	for (const name of [...new Set(patches.map((patch) => patch.name))].sort()) {
		const forName = patches.filter((patch) => patch.name === name);
		const copies = installed.filter((pkg) => pkg.name === name);
		if (copies.length === 0) {
			report.skipped.push(...forName);
			continue;
		}

		const used = new Set<PnpmPatch>();
		for (const copy of copies) {
			const patch = choose(forName, copy.version);
			if (patch == null) {
				continue;
			}
			used.add(patch);
			const fileDiffs = diffs.get(patch.file) ?? (await readPatch(patch, rootDir));
			diffs.set(patch.file, fileDiffs);
			await stage(patch, copy, fileDiffs, writes);
			report.applied.push({ name, version: copy.version, file: patch.file });
		}

		for (const patch of forName) {
			if (used.has(patch) || patch.spec == null) {
				continue;
			}
			const versions = [...new Set(copies.map((copy) => `${name}@${copy.version}`))];
			throw new ForgeError(
				`${patch.file} is for ${patch.key}, but ${shipper} ships ${versions.join(", ")}. ` +
					`Patch the version installed (pnpm patch ${versions[0]}), or change the key in patchedDependencies.`,
			);
		}
	}

	for (const [file, content] of writes) {
		if (content == null) {
			await fs.rm(file);
		} else {
			await io.writeFile(file, content, { mkdir: true, encoding: "utf8" });
		}
	}
	return report;
}

function choose(patches: readonly PnpmPatch[], version: string): PnpmPatch | undefined {
	return (
		patches.find((patch) => patch.exact && patch.spec === version) ??
		patches.find(
			(patch) => !patch.exact && patch.spec != null && semver.satisfies(version, patch.spec),
		) ??
		patches.find((patch) => patch.spec == null)
	);
}

async function readPatch(patch: PnpmPatch, rootDir: string): Promise<FileDiff[]> {
	const file = path.resolve(rootDir, patch.file);
	if (!(await io.fileExists(file))) {
		throw new ForgeError(`The patch for ${patch.key}, ${patch.file}, does not exist.`);
	}
	try {
		return unifiedDiff.parse(await fs.readFile(file, "utf8"));
	} catch (reason) {
		if (reason instanceof UnifiedDiffError) {
			throw new ForgeError(`Can't read ${patch.file}: ${reason.message}`);
		}
		throw reason;
	}
}

/** Works out each file's patched content into `writes`, without touching the disk. */
async function stage(
	patch: PnpmPatch,
	copy: InstalledPackage,
	fileDiffs: readonly FileDiff[],
	writes: Map<string, string | null>,
): Promise<void> {
	for (const diff of fileDiffs) {
		const relative = diff.oldPath ?? diff.newPath ?? "";
		const target = path.resolve(copy.dir, relative);
		if (path.relative(copy.dir, target).startsWith("..") || path.isAbsolute(relative)) {
			throw new ForgeError(
				`${patch.file} changes ${relative}, which is outside ${copy.name}.`,
			);
		}
		const current = writes.has(target)
			? (writes.get(target) ?? undefined)
			: (await io.fileExists(target))
				? await fs.readFile(target, "utf8")
				: undefined;
		try {
			writes.set(target, unifiedDiff.apply(current, diff));
		} catch (reason) {
			if (reason instanceof UnifiedDiffError) {
				throw new ForgeError(
					`${patch.file} doesn't apply to ${copy.name}@${copy.version}: ${relative}: ${reason.message}. ` +
						"Recreate the patch against this version (pnpm patch).",
				);
			}
			throw reason;
		}
	}
}

/** Every package npm installed, including copies nested under another package. */
async function installedPackages(nodeModules: string): Promise<InstalledPackage[]> {
	if (!(await io.directoryExists(nodeModules))) {
		return [];
	}
	const found: InstalledPackage[] = [];
	for (const entry of await fs.readdir(nodeModules, { withFileTypes: true })) {
		if (!entry.isDirectory() || entry.name.startsWith(".")) {
			continue;
		}
		const dirs = entry.name.startsWith("@")
			? (await fs.readdir(path.join(nodeModules, entry.name), { withFileTypes: true }))
					.filter((scoped) => scoped.isDirectory())
					.map((scoped) => path.join(nodeModules, entry.name, scoped.name))
			: [path.join(nodeModules, entry.name)];
		for (const dir of dirs) {
			const manifest = path.join(dir, "package.json");
			if (await io.fileExists(manifest)) {
				const { name, version } = await io.readJsonFile<{ name?: string; version?: string }>(
					manifest,
				);
				if (name != null && version != null) {
					found.push({ name, version, dir });
				}
			}
			found.push(...(await installedPackages(path.join(dir, "node_modules"))));
		}
	}
	return found;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value != null && !Array.isArray(value);
}

export const pnpmPatches = { read, apply };
