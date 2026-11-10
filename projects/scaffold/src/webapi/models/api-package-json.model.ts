import { WELL_KNOWN_FILES } from "../../models/const.js";
import { sortStringMap } from "../../models/package-json.model.js";
import type { KeyedModel, SourceFile } from "../../models/source-file.js";
import { CREATE_VERSION } from "../../version.js";

/**
 * Builder for `projects/<api>/package.json`.
 *
 * Starts with the core `@decohere/http` + `@decohere/crucible` deps. Features can call
 * `addDependency` / `addDevDependency` to extend.
 */
export class ApiPackageJson implements KeyedModel {
	public readonly key = WELL_KNOWN_FILES.API_PACKAGE_JSON;

	private readonly _dependencies: Record<string, string>;
	private readonly _devDependencies: Record<string, string> = {};

	public constructor(
		private readonly workspaceName: string,
		private readonly apiName = "api",
	) {
		this._dependencies = {
			"@decohere/core": CREATE_VERSION,
			"@decohere/http": CREATE_VERSION,
			"@decohere/http-fastify": CREATE_VERSION,
			"@decohere/crucible": CREATE_VERSION,
		};
	}

	public addDependency(name: string, version: string): this {
		this._dependencies[name] = version;
		return this;
	}

	public addDevDependency(name: string, version: string): this {
		this._devDependencies[name] = version;
		return this;
	}

	public files(): SourceFile[] {
		const pkg: Record<string, unknown> = {
			name: `@${this.workspaceName}/${this.apiName}`,
			version: "0.0.1",
			private: true,
			type: "module",
			main: "src/main.ts",
			scripts: {
				lint: "oxlint --fix && prettier --write .",
			},
			dependencies: sortStringMap(this._dependencies),
		};
		if (Object.keys(this._devDependencies).length > 0) {
			pkg.devDependencies = sortStringMap(this._devDependencies);
		}
		return [
			{
				filePath: "package.json",
				content: JSON.stringify(pkg, null, 2),
			},
		];
	}
}
