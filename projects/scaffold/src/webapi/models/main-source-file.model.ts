import { WELL_KNOWN_FILES } from "../../models/const.js";
import type { KeyedModel, SourceFile } from "../../models/source-file.js";

export type TypeOrmImport = { className: string; importPath: string };
export type ServiceImport = TypeOrmImport & { scope?: "singleton" | "request" };

/** Tracks named imports from a single module path, split into values and types. */
class ImportGroup {
	private readonly _values: string[] = [];
	private readonly _types: string[] = [];

	public add(name: string, typeOnly = false): this {
		if (typeOnly) {
			// Value import already present — value wins, skip
			if (!this._values.includes(name) && !this._types.includes(name)) {
				this._types.push(name);
			}
		} else {
			// Promote: remove from types if it was previously type-only
			const typeIdx = this._types.indexOf(name);
			if (typeIdx !== -1) this._types.splice(typeIdx, 1);
			if (!this._values.includes(name)) this._values.push(name);
		}
		return this;
	}

	public render(from: string): string {
		const values = [...this._values].sort();
		const types = [...this._types].sort().map((n) => `type ${n}`);
		return `import { ${[...values, ...types].join(", ")} } from "${from}";`;
	}
}

/**
 * Model for `projects/api/src/main.ts`.
 *
 * Starts with the minimal HTTP + YAML config setup. Features mutate the model
 * by calling addSideEffectImport / addImport / addBuilderCall / addEntity /
 * addRepository. files() renders whatever has been accumulated.
 */
export class MainSourceFile implements KeyedModel {
	public readonly key = WELL_KNOWN_FILES.MAIN_TS;

	private readonly _sideEffectImports: string[] = [];
	private readonly _extraImports = new Map<string, ImportGroup>();
	private readonly _builderCalls: string[] = [];
	private readonly _entities: TypeOrmImport[] = [];
	private readonly _repositories: TypeOrmImport[] = [];
	private readonly _services: ServiceImport[] = [];
	private _dataSourceName: string | undefined;
	private _typeOrmSeed: string | undefined;

	public constructor(private readonly appName: string) {}

	/** Adds a bare side-effect import, e.g. `@decohere/http/auth`. */
	public addSideEffectImport(path: string): this {
		if (!this._sideEffectImports.includes(path)) this._sideEffectImports.push(path);
		return this;
	}

	/** Adds a named import, e.g. `import { Foo } from "bar"`. */
	public addImport(name: string, from: string, typeOnly = false): this {
		const group = this._extraImports.get(from) ?? new ImportGroup();
		group.add(name, typeOnly);
		this._extraImports.set(from, group);
		return this;
	}

	/**
	 * Adds a builder call inserted after `.withConfiguration()` and before
	 * `.withServices()`. Pass the call without leading dot, e.g. `.withAuth()`.
	 */
	public addBuilderCall(call: string): this {
		this._builderCalls.push(call);
		return this;
	}

	/** Adds a TypeORM entity — import and entry in `withTypeOrm({ entities })`. */
	public addEntity(entity: TypeOrmImport): this {
		this._entities.push(entity);
		return this;
	}

	/** Adds a TypeORM repository — import and entry in `withTypeOrm({ repositories })`. */
	public addRepository(repo: TypeOrmImport): this {
		this._repositories.push(repo);
		return this;
	}

	/** Adds a service registered in `.withServices()`. */
	public addService(service: ServiceImport): this {
		this._services.push(service);
		return this;
	}

	/**
	 * Datasource name passed to `withTypeOrm({ name })`. Must match
	 * `database.dataSources[].name` in config.yaml.
	 */
	public setDataSourceName(name: string): this {
		this._dataSourceName = name;
		return this;
	}

	/**
	 * Inline seed callback body for `withTypeOrm({ seed })`.
	 * Receives `dataSource` in scope. Example: `await dataSource.getRepository(User).save(...)`.
	 */
	public setTypeOrmSeed(seedBody: string): this {
		this._typeOrmSeed = seedBody;
		return this;
	}

	public files(): SourceFile[] {
		const imports: string[] = [
			'import "@decohere/scribe-pino";',
			'import "@decohere/http/http";',
		];

		for (const path of this._sideEffectImports) {
			imports.push(`import "${path}";`);
		}

		imports.push(
			'import "@decohere/config";',
			'import { YamlDataSource } from "@decohere/config";',
			'import { Builder } from "@decohere/http";',
			'import { FastifyProvider } from "@decohere/http/providers";',
			'import { scribe } from "@decohere/scribe";',
			'import { SampleService } from "./services/sample.service.js";',
		);

		for (const e of this._entities) {
			imports.push(`import { ${e.className} } from "${e.importPath}";`);
		}

		for (const r of this._repositories) {
			imports.push(`import { ${r.className} } from "${r.importPath}";`);
		}

		for (const s of this._services) {
			imports.push(`import { ${s.className} } from "${s.importPath}";`);
		}

		for (const [from, group] of this._extraImports) {
			imports.push(group.render(from));
		}

		imports.push('import { HelloController } from "./controllers/hello.controller.js";');

		const serviceRegs = [
			"cb.registerSingleton(SampleService);",
			...this._services.map((s) =>
				s.scope === "request"
					? `cb.registerRequestScoped(${s.className});`
					: `cb.registerSingleton(${s.className});`,
			),
		].join(" ");

		const builderCalls: string[] = [
			`\t.withHttp(FastifyProvider)`,
			`\t.withConfiguration(YamlDataSource)`,
			`\t.withHealth()`,
			`\t.withOpenApi({ info: { title: "${this.appName}", version: "1.0.0" } })`,
			...this._builderCalls.map((c) => `\t${c}`),
			`\t.withServices((cb) => { ${serviceRegs} })`,
		];

		if (this._entities.length > 0) {
			const entities = this._entities.map((e) => e.className).join(", ");
			const repos = this._repositories.map((r) => r.className).join(", ");
			const named = this._dataSourceName != null ? `name: "${this._dataSourceName}", ` : "";
			if (this._typeOrmSeed) {
				builderCalls.push(
					`\t.withTypeOrm({ ${named}entities: [${entities}], repositories: [${repos}], seed: async (dataSource) => { ${this._typeOrmSeed} } })`,
				);
			} else {
				builderCalls.push(
					`\t.withTypeOrm({ ${named}entities: [${entities}], repositories: [${repos}] })`,
				);
			}
		}

		builderCalls.push(`\t.withControllers(HelloController)`);

		const content = [
			...imports,
			"",
			`scribe.withPinoPretty().and.withPinoRoll({ file: "logs/${this.appName}.log" });`,
			"",
			`const app = await Builder.create({ applicationName: "${this.appName}" })`,
			...builderCalls,
			`\t.build();`,
			"",
			"await app.start({ port: Number(process.env.PORT ?? 3000) });",
			"",
			"export default app;",
			"",
		].join("\n");

		return [
			{
				filePath: "src/main.ts",
				content,
			},
		];
	}
}
