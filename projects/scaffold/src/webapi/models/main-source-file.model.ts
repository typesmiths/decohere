import { WELL_KNOWN_FILES } from "../../models/const.js";
import type { KeyedModel, SourceFile } from "../../models/source-file.js";
import type { Orm } from "../database-provider.js";

export type ClassImport = { className: string; importPath: string };
export type ServiceImport = ClassImport & { scope?: "singleton" | "request" };

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

const PROVIDER = {
	"mikro-orm": { plugin: "mikroOrm", from: "@decohere/data-mikro-orm", seedParam: "orm" },
	typeorm: { plugin: "typeOrm", from: "@decohere/data-typeorm", seedParam: "dataSource" },
} as const;

/**
 * Model for an API's entry files:
 *
 * - `src/app.ts`: `createApp()` builds the app and starts nothing, so a tool or a test can use it;
 * - `src/main.ts`: sets up logging and starts the app;
 * - `src/db.ts`, with a database: the db commands (`pnpm db migrate`).
 *
 * Starts with the minimal HTTP + YAML config setup. Features mutate the model by calling
 * addImport / addBuilderCall / addEntity / addRepository. files() renders whatever has been
 * accumulated.
 */
export class MainSourceFile implements KeyedModel {
	public readonly key = WELL_KNOWN_FILES.MAIN_TS;

	private readonly _extraImports = new Map<string, ImportGroup>();
	private readonly _builderCalls: string[] = [];
	private readonly _entities: ClassImport[] = [];
	private readonly _repositories: ClassImport[] = [];
	private readonly _services: ServiceImport[] = [];
	private _orm: Orm = "mikro-orm";
	private _dataSourceName: string | undefined;
	private _seed: string | undefined;

	public constructor(
		private readonly appName: string,
		private readonly apiName = "api",
	) {
		this.addImport("health", "@decohere/http").addImport("http", "@decohere/http");
	}

	/** Adds a named import to `app.ts`, e.g. `import { Foo } from "bar"`. */
	public addImport(name: string, from: string, typeOnly = false): this {
		const group = this._extraImports.get(from) ?? new ImportGroup();
		group.add(name, typeOnly);
		this._extraImports.set(from, group);
		return this;
	}

	/**
	 * Adds a builder call inserted after `.use(config())` and before
	 * `.withServices()`. Pass the call with its leading dot, e.g. `.use(auth())`.
	 */
	public addBuilderCall(call: string): this {
		this._builderCalls.push(call);
		return this;
	}

	/** The ORM the provider plugin is for. MikroORM unless set. */
	public setOrm(orm: Orm): this {
		this._orm = orm;
		return this;
	}

	/** Adds a mapping: its import, and an entry in the provider's `entities`. */
	public addEntity(entity: ClassImport): this {
		this._entities.push(entity);
		return this;
	}

	/** Adds a repository: its import, and an entry in the provider's `repositories`. */
	public addRepository(repo: ClassImport): this {
		this._repositories.push(repo);
		return this;
	}

	/** Adds a service registered in `.withServices()`. */
	public addService(service: ServiceImport): this {
		this._services.push(service);
		return this;
	}

	/**
	 * Data source name passed to the provider's `name`. Must match
	 * `database.dataSources[].name` in config.yaml.
	 */
	public setDataSourceName(name: string): this {
		this._dataSourceName = name;
		return this;
	}

	/**
	 * Inline body of the provider's `seed` callback, which gets `orm` (MikroORM) or
	 * `dataSource` (TypeORM).
	 */
	public setSeed(seedBody: string): this {
		this._seed = seedBody;
		return this;
	}

	public files(): SourceFile[] {
		const files = [
			{ filePath: "src/app.ts", content: this.renderApp() },
			{ filePath: "src/main.ts", content: this.renderMain() },
		];
		if (this._entities.length > 0) files.push({ filePath: "src/db.ts", content: DB_TS });
		return files;
	}

	private renderApp(): string {
		const provider = PROVIDER[this._orm];
		const imports: string[] = [
			'import { config, EnvDataSource, YamlDataSource } from "@decohere/config";',
			'import { Builder } from "@decohere/core/hosting";',
			'import { ServiceContainerBuilder } from "@decohere/crucible";',
			'import { FastifyProvider } from "@decohere/http/providers";',
			'import { SampleService } from "./services/sample.service.js";',
		];

		if (this._entities.length > 0) {
			imports.push(`import { ${provider.plugin} } from "${provider.from}";`);
			// Creates the database, roles and schema in development, and runs migrations.
			imports.push('import { postgres } from "@decohere/data-postgres";');
			imports.push('import { migrations } from "./migrations/index.js";');
		}

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
			`\t\t.use(http(FastifyProvider, { controllers: [HelloController], openApi: { info: { title: "${this.appName}", version: "1.0.0" } } }))`,
			`\t\t.use(config(new YamlDataSource({ app: "${this.apiName}" }), EnvDataSource))`,
			`\t\t.use(health())`,
			...this._builderCalls.map((c) => `\t\t${c}`),
			`\t\t.withServices((cb) => { ${serviceRegs} })`,
		];

		if (this._entities.length > 0) {
			const entities = this._entities.map((e) => e.className).join(", ");
			const repos = this._repositories.map((r) => r.className).join(", ");
			const named = this._dataSourceName != null ? `name: "${this._dataSourceName}", ` : "";
			const seed = this._seed
				? `, seed: async (${provider.seedParam}) => { ${this._seed} }`
				: "";
			builderCalls.push(
				`\t\t.use(${provider.plugin}({ ${named}entities: [${entities}], repositories: [${repos}], database: postgres, migrations${seed} }))`,
			);
		}

		return [
			...imports,
			"",
			"/** Builds the app and starts nothing: main.ts starts it, and db.ts and tests use it as built. */",
			"export function createApp() {",
			`\treturn Builder.create(new ServiceContainerBuilder(), { applicationName: "${this.appName}" })`,
			...builderCalls,
			`\t\t.build();`,
			"}",
			"",
		].join("\n");
	}

	private renderMain(): string {
		return [
			'import "@decohere/scribe-pino";',
			'import { scribe } from "@decohere/scribe";',
			'import { createApp } from "./app.js";',
			"",
			`scribe.withPinoPretty().and.withPinoRoll({ file: "logs/${this.appName}.log" });`,
			"",
			"const app = await createApp();",
			"await app.start({ port: Number(process.env.PORT ?? 3000) });",
			"",
			"export default app;",
			"",
		].join("\n");
	}
}

const DB_TS = `import { db } from "@decohere/data";
import { createApp } from "./app.js";

// The db commands: pnpm db migrate | status | revert | new <name> [--data] | generate <name>.
// The app is built, not started: no migration runs on start, and nothing listens.
const app = await createApp();
try {
	await db.run(app, process.argv.slice(2), { directory: new URL("./migrations/", import.meta.url) });
} finally {
	await app.dispose();
}
`;
