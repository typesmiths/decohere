import path from "node:path";
import { injectable } from "@decohere/crucible/decorators";
import type { PackageJson } from "@decohere/workspace";
import { io } from "@decohere/core/io";
import { scribe } from "@decohere/scribe";
import { parseImports } from "parse-imports";
import { BUILT_IN_MODULES } from "../const.js";
import { ForgeError } from "../errors.js";
import { type ReleaseExports, releaseExports } from "./release-exports.js";

/** A workspace project as the packager sees it: its manifest and its release build. */
export type ReleaseProject = {
	/** The package name, e.g. `@app/kernel`. */
	name: string;
	pkg: PackageJson;
	/** Absolute path of the project folder (source). */
	projectRoot: string;
	/** Absolute path of the project's release output (holds `es6/`). */
	releaseDir: string;
};

export type ReachedPackages = {
	/** Workspace packages the entry reaches, including the entry's own project. */
	workspace: Set<string>;
	/**
	 * Third-party package name to the workspace packages whose code imports it. Not what
	 * ships (declared dependencies do); only used to fail on an import nothing ships.
	 */
	thirdParty: Map<string, Set<string>>;
};

type QueuedFile = { file: string; owner: ReleaseProject };

const CODE_FILE = /\.(?:js|mjs|cjs)$/;

/**
 * Walks the compiled (release) import graph from a deployable's entry point and reports which
 * workspace and third-party packages the code actually reaches. Code that nothing imports (a
 * library's `testing/` folder, say) is never opened, so its dependencies are not collected.
 */
@injectable()
export class ImportGraph {
	#logger = scribe.logger(ImportGraph.name);

	public async walk(
		entry: ReleaseProject,
		projects: ReadonlyMap<string, ReleaseProject>,
	): Promise<ReachedPackages> {
		const reached: ReachedPackages = {
			workspace: new Set([entry.name]),
			thirdParty: new Map(),
		};
		const exportsByProject = new Map<string, ReleaseExports>();
		const seen = new Set<string>();
		const queue: QueuedFile[] = [
			{
				file: path.join(
					entry.releaseDir,
					"es6",
					releaseExports.toJs(entry.pkg.main ?? "src/index.ts"),
				),
				owner: entry,
			},
		];

		while (queue.length > 0) {
			const { file, owner } = queue.pop() as QueuedFile;
			if (seen.has(file)) {
				continue;
			}
			seen.add(file);

			for (const specifier of await this.importsOf(file, owner)) {
				if (specifier.startsWith(".")) {
					queue.push({ file: await this.resolveRelative(file, specifier, owner), owner });
				} else if (!isBuiltin(specifier)) {
					this.follow(specifier, owner, projects, exportsByProject, reached, queue);
				}
			}
		}
		return reached;
	}

	private follow(
		specifier: string,
		importer: ReleaseProject,
		projects: ReadonlyMap<string, ReleaseProject>,
		exportsByProject: Map<string, ReleaseExports>,
		reached: ReachedPackages,
		queue: QueuedFile[],
	): void {
		const name = packageName(specifier);
		const project = projects.get(name);
		if (project == null) {
			const owners = reached.thirdParty.get(name) ?? new Set<string>();
			owners.add(importer.name);
			reached.thirdParty.set(name, owners);
			return;
		}

		reached.workspace.add(name);
		let exports = exportsByProject.get(name);
		if (exports == null) {
			exports = releaseExports.build(project.pkg);
			exportsByProject.set(name, exports);
		}

		const subpath = specifier.slice(name.length);
		const target = releaseExports.resolve(exports, subpath);
		if (target == null) {
			throw new ForgeError(
				`${importer.name} imports "${specifier}", but ${name} does not export "${subpath === "" ? "." : `.${subpath}`}".`,
			);
		}
		queue.push({ file: path.join(project.releaseDir, target), owner: project });
	}

	private async importsOf(file: string, owner: ReleaseProject): Promise<string[]> {
		if (!(await io.fileExists(file))) {
			throw new ForgeError(
				`${file} is imported by ${owner.name} but was not built. ` +
					"Run `forge build --configuration release` first.",
			);
		}
		if (!CODE_FILE.test(file)) {
			return [];
		}

		const code = await io.readFile(file);
		const specifiers: string[] = [];
		try {
			for (const entry of await parseImports(code)) {
				if (entry.moduleSpecifier.value != null) {
					specifiers.push(entry.moduleSpecifier.value);
				} else if (entry.isDynamicImport) {
					this.#logger.warn(
						`${file}: dynamic import of ${entry.moduleSpecifier.code} cannot be followed; ` +
							"whatever it loads is not packaged",
					);
				}
			}
		} catch (reason) {
			throw new ForgeError(
				`Could not read the imports of ${file}: ${reason instanceof Error ? reason.message : String(reason)}`,
			);
		}
		return specifiers;
	}

	/** Compiled output keeps explicit `.js` paths; tolerate extensionless and folder imports. */
	private async resolveRelative(
		importer: string,
		specifier: string,
		owner: ReleaseProject,
	): Promise<string> {
		const base = path.resolve(path.dirname(importer), specifier);
		for (const candidate of [base, `${base}.js`, path.join(base, "index.js")]) {
			if (await io.fileExists(candidate)) {
				return candidate;
			}
		}
		throw new ForgeError(
			`${importer} (${owner.name}) imports "${specifier}", which was not built. ` +
				"Run `forge build --configuration release` first.",
		);
	}
}

/** `@scope/pkg/deep/path` becomes `@scope/pkg`; `pkg/deep` becomes `pkg`. */
function packageName(specifier: string): string {
	const parts = specifier.split("/");
	return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

function isBuiltin(specifier: string): boolean {
	return (
		specifier.startsWith("node:") ||
		BUILT_IN_MODULES.includes(specifier) ||
		BUILT_IN_MODULES.includes(packageName(specifier))
	);
}
