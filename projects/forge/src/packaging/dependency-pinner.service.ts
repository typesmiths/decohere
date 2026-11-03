import path from "node:path";
import { injectable } from "@decohere/crucible/decorators";
import type { PackageJson } from "@decohere/workspace";
import { io } from "@decohere/core/io";
import { ForgeError } from "../errors.js";
import type { ReachedPackages, ReleaseProject } from "./import-graph.service.js";

/** A manifest whose `dependencies` ship: the deployable, a copied library, or the workspace root. */
type Scope = { name: string; dir: string; pkg: PackageJson };

/**
 * Chooses the third-party `dependencies` for the packaged `package.json`: the union of
 * `dependencies` (never devDependencies) of the deployable, every library copied in, and the
 * workspace root. Declared is shipped, whether or not code imports it (a runtime-loaded pino
 * transport, say), so removing an unused dependency is the author's job. Each is pinned to the
 * exact version installed in the workspace, so the image runs what the tests ran.
 *
 * Code that imports a third-party package nothing ships is a crash waiting to happen, so that
 * is an error: the package is only a devDependency, or declared nowhere.
 */
@injectable()
export class DependencyPinner {
	public async pin(
		imported: ReachedPackages["thirdParty"],
		shipped: readonly ReleaseProject[],
		projects: ReadonlyMap<string, ReleaseProject>,
		workspaceRoot: { dir: string; pkg: PackageJson },
	): Promise<Record<string, string>> {
		const scopes: Scope[] = [
			...shipped.map((project) => ({
				name: project.name,
				dir: project.projectRoot,
				pkg: project.pkg,
			})),
			{ name: "the workspace root", dir: workspaceRoot.dir, pkg: workspaceRoot.pkg },
		];

		const declaredBy = new Map<string, Scope[]>();
		for (const scope of scopes) {
			for (const name of Object.keys(scope.pkg.dependencies ?? {})) {
				if (projects.has(name)) {
					continue; // a workspace library, copied from its build, never installed
				}
				declaredBy.set(name, [...(declaredBy.get(name) ?? []), scope]);
			}
		}

		this.assertImportsAreShipped(imported, declaredBy, scopes);

		const pinned: Record<string, string> = {};
		for (const name of [...declaredBy.keys()].sort()) {
			pinned[name] = await this.installedVersion(
				name,
				declaredBy.get(name) ?? [],
				workspaceRoot.dir,
			);
		}
		return pinned;
	}

	private assertImportsAreShipped(
		imported: ReachedPackages["thirdParty"],
		declaredBy: ReadonlyMap<string, Scope[]>,
		scopes: readonly Scope[],
	): void {
		for (const name of [...imported.keys()].sort()) {
			if (declaredBy.has(name)) {
				continue;
			}
			const importers = [...(imported.get(name) ?? [])].sort().join(", ");
			const devOnly = scopes.find((scope) => scope.pkg.devDependencies?.[name] != null);
			if (devOnly != null) {
				throw new ForgeError(
					`${name} is imported at run time by ${importers}, but it is only a devDependency ` +
						`(of ${devOnly.name}). Move it to "dependencies".`,
				);
			}
			throw new ForgeError(
				`${name} is imported at run time by ${importers}, but is not in "dependencies" of the ` +
					"deployable, any library it uses, or the workspace root package.json. Add it there.",
			);
		}
	}

	private async installedVersion(
		name: string,
		declarers: readonly Scope[],
		workspaceRootDir: string,
	): Promise<string> {
		const versions = new Map<string, string>();
		for (const scope of declarers) {
			const version =
				(await findInstalledVersion(name, scope.dir)) ??
				(await findInstalledVersion(name, workspaceRootDir));
			if (version == null) {
				throw new ForgeError(
					`${name} is declared by ${scope.name} but is not installed. ` +
						"Run the package manager install first.",
				);
			}
			versions.set(scope.name, version);
		}

		const distinct = new Set(versions.values());
		if (distinct.size > 1) {
			const detail = [...versions]
				.map(([owner, version]) => `${owner}: ${version}`)
				.join(", ");
			throw new ForgeError(
				`${name} is installed at different versions for the packages that declare it (${detail}). ` +
					"One packaged app can only ship one version; align them.",
			);
		}
		const [version] = distinct;
		if (version == null) {
			throw new ForgeError(`${name} is not installed. Run the package manager install first.`);
		}
		return version;
	}
}

/** Looks for `node_modules/<name>` in `fromDir` and each folder above it, as Node does. */
async function findInstalledVersion(
	name: string,
	fromDir: string,
): Promise<string | undefined> {
	let dir = path.resolve(fromDir);
	for (;;) {
		const manifest = path.join(dir, "node_modules", name, "package.json");
		if (await io.fileExists(manifest)) {
			const { version } = await io.readJsonFile<{ version?: string }>(manifest);
			return version;
		}
		const parent = path.dirname(dir);
		if (parent === dir) {
			return undefined;
		}
		dir = parent;
	}
}
