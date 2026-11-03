import { WELL_KNOWN_FILES } from "../../models/const.js";
import type { KeyedModel, SourceFile } from "../../models/source-file.js";

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
 * A controller method. Features call `addDecorator()` to prepend decorators
 * before the HTTP verb decorator (e.g. `@AllowAnonymous` before `@Get()`).
 */
export class ControllerMethod {
	private readonly _extraDecorators: string[] = [];
	private _body: string[];
	private _isAsync: boolean;

	public constructor(
		public readonly name: string,
		private readonly _httpDecorator: string,
		private readonly _params: string,
		isAsync: boolean,
		body: string[],
	) {
		this._isAsync = isAsync;
		this._body = body;
	}

	public addDecorator(decorator: string): this {
		this._extraDecorators.push(decorator);
		return this;
	}

	/** Replace the method body lines (used by features that extend generated behaviour). */
	public setBody(body: string[]): this {
		this._body = body;
		return this;
	}

	public setAsync(isAsync = true): this {
		this._isAsync = isAsync;
		return this;
	}

	public render(): string[] {
		const lines: string[] = [];
		for (const d of this._extraDecorators) {
			lines.push(`\t${d}`);
		}
		lines.push(`\t${this._httpDecorator}`);
		const asyncKw = this._isAsync ? "async " : "";
		lines.push(`\tpublic ${asyncKw}${this.name}(${this._params}) {`);
		for (const line of this._body) {
			lines.push(`\t\t${line}`);
		}
		lines.push("\t}");
		return lines;
	}
}

/**
 * Model for `projects/api/src/controllers/hello.controller.ts`.
 *
 * Pre-initialised with all routes and their HTTP decorators. Features mutate
 * the model via `getMethod(name).addDecorator(...)`, `addDecorator(...)` (class
 * level), `addCortexImport(...)`, `addImport(...)`, and `addConstructorParam(...)`.
 */
export class ControllerSourceFile implements KeyedModel {
	public readonly key = WELL_KNOWN_FILES.CONTROLLER_TS;

	private readonly _cortexImports = new ImportGroup()
		.add("Controller")
		.add("Delete")
		.add("Field")
		.add("Get")
		.add("Param")
		.add("Post")
		.add("Put")
		.add("Query");

	private readonly _extraImportGroups = new Map<string, ImportGroup>([
		["@decohere/crucible/decorators", new ImportGroup().add("inject")],
	]);
	private readonly _classDecorators: string[] = [];
	/** Explicit @inject(SampleService): using the class as a value keeps its import, which SWC can drop when the class is only a type (design:paramtypes then collapses to Object). */
	private readonly _ctorParams: string[] = [
		"@inject(SampleService) private readonly sample: SampleService",
	];

	private readonly _methods = new Map<string, ControllerMethod>([
		[
			"getAll",
			new ControllerMethod("getAll", "@Get()", '@Query("filter") filter: string', true, [
				"const greeting = await this.sample.getGreeting();",
				"return { filter, message: greeting };",
			]),
		],
		[
			"getOne",
			new ControllerMethod("getOne", '@Get("/:id")', '@Param("id") id: string', false, [
				"return { id, message: `Hello ${id}!` };",
			]),
		],
		[
			"create",
			new ControllerMethod("create", "@Post()", "body: HelloBody", false, [
				"return { message: body.message };",
			]),
		],
		[
			"update",
			new ControllerMethod(
				"update",
				'@Put("/:id")',
				'@Param("id") id: string, body: HelloBody',
				false,
				["return { id, message: body.message };"],
			),
		],
		[
			"remove",
			new ControllerMethod("remove", '@Delete("/:id")', '@Param("id") id: string', false, [
				"return { id, deleted: true };",
			]),
		],
	]);

	/** Retrieve a method by name to mutate its decorators. */
	public getMethod(name: string): ControllerMethod {
		const m = this._methods.get(name);
		if (m == null) throw new Error(`No method '${name}' on ControllerSourceFile`);
		return m;
	}

	/** Add a class-level decorator (e.g. `@Authorize`). */
	public addDecorator(decorator: string): this {
		this._classDecorators.push(decorator);
		return this;
	}

	/** Add a named import from `@decohere/http`. */
	public addCortexImport(name: string, typeOnly = false): this {
		this._cortexImports.add(name, typeOnly);
		return this;
	}

	/** Add a named import from any other module. */
	public addImport(name: string, from: string, typeOnly = false): this {
		const group = this._extraImportGroups.get(from) ?? new ImportGroup();
		group.add(name, typeOnly);
		this._extraImportGroups.set(from, group);
		return this;
	}

	/** Add a constructor parameter (e.g. an injected dependency). */
	public addConstructorParam(param: string): this {
		this._ctorParams.push(param);
		return this;
	}

	public files(): SourceFile[] {
		const lines: string[] = [
			this._cortexImports.render("@decohere/http"),
			'import { SampleService } from "../services/sample.service.js";',
		];

		for (const [from, group] of this._extraImportGroups) {
			lines.push(group.render(from));
		}

		lines.push(
			"",
			"class HelloBody {",
			'\t@Field("body", "message")',
			"\tpublic message!: string;",
			"}",
			"",
		);

		for (const d of this._classDecorators) {
			lines.push(d);
		}
		lines.push('@Controller({ prefix: "/hello" })', "export class HelloController {", "");

		lines.push("\tpublic constructor(");
		for (const p of this._ctorParams) {
			lines.push(`\t\t${p},`);
		}
		lines.push("\t) {}");
		lines.push("");

		for (const method of this._methods.values()) {
			lines.push(...method.render(), "");
		}

		lines.push("}", "");

		return [
			{
				filePath: "src/controllers/hello.controller.ts",
				content: lines.join("\n"),
			},
		];
	}
}
