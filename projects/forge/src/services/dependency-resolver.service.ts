import { injectable } from "@decohere/crucible/decorators";
import type { PackageJson, Project, Workspace } from "@decohere/workspace";
import { type FileEx, io } from "@decohere/core/io";
import { parseImports } from "parse-imports";
import { BUILT_IN_MODULES } from "../const.js";
import { ForgeError } from "../errors.js";
import type {
	DependencyWarning,
	DependencyLists,
	DriftEntry,
	Package,
	ResolvedDependency,
} from "../types/dependency.types.js";

export type ProjectDependencies = {
	project: Project;
	updatedPackage: PackageJson;
	warnings: DependencyWarning[];
};

@injectable()
export class DependencyResolver {
	public computeDrift(current: PackageJson, computed: PackageJson): DriftEntry | null {
		const lists = (pkg: PackageJson): DependencyLists => {
			const sortKeys = (obj: Record<string, string> | undefined) =>
				Object.fromEntries(Object.entries(obj ?? {}).sort());
			return {
				dependencies: sortKeys(pkg.dependencies),
				devDependencies: sortKeys(pkg.devDependencies),
				peerDependencies: sortKeys(pkg.peerDependencies),
			};
		};

		const original = lists(current);
		const updated = lists(computed);
		if (JSON.stringify(original) === JSON.stringify(updated)) {
			return null;
		}
		return { original, updated };
	}

	public async getWorkspacePackages(
		workspace: Workspace,
		projects: readonly Project[],
	): Promise<Map<string, Package>> {
		const packageJson = await workspace.getPackageJson().catch(() => {
			throw new Error(
				`Root package.json not found at "${workspace.packageJsonDirectory}/package.json". ` +
					`Ensure the workspace root has a package.json with dependencies listed.`,
			);
		});

		const internals = new Map(
			await Promise.all(
				projects.map(async (proj): Promise<[string, Package]> => {
					const packageJson = await proj.getPackageJson();
					return [
						packageJson.name,
						{
							name: packageJson.name,
							version: packageJson.version,
							isInternal: true,
						},
					];
				}),
			),
		);

		const packages = Object.entries(packageJson.dependencies)
			.filter(([key]) => !internals.has(key))
			.map<[string, Package]>(([key, val]) => [key, { name: key, version: val }]);

		const devPackages = Object.entries(packageJson.devDependencies)
			.filter(([key]) => !internals.has(key))
			.map<[string, Package]>(([key, val]) => [key, { name: key, version: val, isDev: true }]);

		return new Map([...packages, ...devPackages, ...internals]);
	}

	public async computeProjectDependencies(
		project: Project,
		workspacePackages: Map<string, Package>,
	): Promise<ProjectDependencies> {
		const pkg = await project.getPackageJson();
		const peerNames = Object.keys(pkg.peerDependencies ?? {});
		const peerDependencies = this.getPeerDependencies(project, peerNames, workspacePackages);
		const { dependencies, devDependencies, warnings } = await this.getDependencies(
			project,
			workspacePackages,
			new Set(peerNames),
		);

		let updatedPackage = pkg
			.withDependencies(dependencies)
			.withDevDependencies(devDependencies);
		if (peerNames.length > 0) {
			updatedPackage = updatedPackage.withPeerDependencies(peerDependencies);
		}

		return { project, updatedPackage, warnings };
	}

	/**
	 * A package declares its peers by name in its own `peerDependencies` (and marks optional ones in
	 * `peerDependenciesMeta`, which sync leaves as written). The root owns every version, so each
	 * peer gets the root's range; a peer the root doesn't list is an error. A declared peer stays
	 * even when no code imports it: a pino transport, say, is loaded by name.
	 */
	private getPeerDependencies(
		project: Project,
		peerNames: readonly string[],
		workspacePackages: Map<string, Package>,
	): Record<string, string> {
		const peers: Record<string, string> = {};
		for (const name of [...peerNames].sort()) {
			const version = workspacePackages.get(name)?.version;
			if (version == null) {
				throw new ForgeError(
					`"${name}" is declared a peer of ${project.name}, but the root package.json doesn't list it. ` +
						"Add it there: the root owns every version.",
				);
			}
			peers[name] = version;
		}
		return peers;
	}

	private async getDependencies(
		project: Project,
		workspacePackages: Map<string, Package>,
		peers: ReadonlySet<string>,
	) {
		const files = await project.getAllFiles();
		const results = await Promise.all(
			files.map(async (file) => ({ file, ...(await this.getFileImports(file)) })),
		);
		const warnings = results.flatMap((r) => r.warnings);

		/** Which files import each package, for errors that point at the code. */
		const importedBy = new Map<string, Set<string>>();
		const allDependencies: ResolvedDependency[] = [];
		for (const { file, imports } of results) {
			for (const fileImport of imports) {
				const dep = this.getDependencyFrom(fileImport, workspacePackages);
				if (dep == null || peers.has(dep.name)) {
					continue;
				}
				if (!importedBy.has(dep.name)) {
					importedBy.set(dep.name, new Set());
					allDependencies.push(dep);
				}
				importedBy.get(dep.name)?.add(file.relativePath);
			}
		}

		const missing = allDependencies.filter(
			(dep): dep is ResolvedDependency & { missing: true } => dep.missing,
		);

		if (missing.length > 0) {
			const names = missing.map((dep) => dep.name).join(", ");
			throw new ForgeError(`Missing packages in project "${project.name}": ${names}`);
		}

		const resolved = allDependencies.filter(
			(dep): dep is ResolvedDependency & { missing: false } => !dep.missing,
		);

		// A configuration that packs is the published shape: its files ship, so a package they
		// import that the root keeps for development would be missing for the consumer.
		if (project.configuration.pack === true) {
			const devOnly = resolved.filter((dep) => dep.isDev && !dep.internal);
			if (devOnly.length > 0) {
				const lines = devOnly.map(
					(dep) =>
						`  - ${dep.name}, imported by ${[...(importedBy.get(dep.name) ?? [])].sort().join(", ")}`,
				);
				throw new ForgeError(
					`${project.name} ships code that imports packages the root lists only as a devDependency:\n` +
						`${lines.join("\n")}\n` +
						"Move each to the root's dependencies, or, if the consumer provides it, " +
						`declare it in ${project.name}'s peerDependencies.`,
				);
			}
		}

		const dependencies = Object.fromEntries(
			resolved
				.filter((dep) => !dep.isDev)
				.map<[string, string]>((dep) => [dep.name, dep.version]),
		);

		const devDependencies = Object.fromEntries(
			resolved
				.filter((dep) => dep.isDev)
				.map<[string, string]>((dep) => [dep.name, dep.version]),
		);

		return { dependencies, devDependencies, warnings };
	}

	private getDependencyFrom(
		importName: string,
		workspacePackages: Map<string, Package>,
	): ResolvedDependency | undefined {
		if (importName.startsWith(".") || importName.startsWith("node:")) {
			return;
		}

		const packageNameMatch = importName.match(/^(?:(@[^/]+\/[^/]+)|([^/]+))/);
		const packageName = packageNameMatch?.[0];

		if (packageName == null || BUILT_IN_MODULES.includes(packageName)) {
			return;
		}

		const packg = workspacePackages.get(packageName);

		if (packg == null) {
			return {
				name: packageName,
				version: undefined,
				internal: undefined,
				missing: true,
				isDev: false,
			};
		}

		return {
			name: packageName,
			version: packg.version ?? "",
			internal: packg.isInternal ?? false,
			missing: false,
			isDev: packg.isDev ?? false,
		};
	}

	private async getFileImports(
		file: FileEx,
	): Promise<{ imports: string[]; warnings: DependencyWarning[] }> {
		const contents = await io.readFile(file.fullPath);
		const parsed = Array.from(await parseImports(contents));

		const imports: string[] = [];
		const warnings: DependencyWarning[] = [];

		for (const impt of parsed) {
			if (impt.moduleSpecifier.value != null) {
				imports.push(impt.moduleSpecifier.value);
			} else if (impt.isDynamicImport) {
				const line = contents.substring(0, impt.startIndex).split("\n").length;
				warnings.push({
					file: file.fullPath,
					line,
					message: `Dynamic import with non-literal specifier \`${impt.moduleSpecifier.code}\` cannot be statically resolved`,
				});
			}
		}

		return { imports, warnings };
	}
}
