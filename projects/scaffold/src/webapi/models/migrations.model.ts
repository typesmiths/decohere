import { WELL_KNOWN_FILES } from "../../models/const.js";
import type { KeyedModel, SourceFile } from "../../models/source-file.js";

type SchemaMigration = { name: string; up: string[]; down: string[] };

/**
 * An API's `src/migrations/` folder: the migrations that create the tables the scaffold maps, and
 * the `index.ts` that lists them, written as `db generate` and `db new` from `@decohere/data` write them.
 * Features add their tables in the order they run, so the ids sort the same way.
 */
export class MigrationsModel implements KeyedModel {
	public readonly key = WELL_KNOWN_FILES.MIGRATIONS;
	private readonly migrations: SchemaMigration[] = [];

	/** @param now When the first migration is written; each next one is a second later. */
	public constructor(private readonly now = new Date()) {}

	public add(name: string, up: string[], down: string[]): this {
		this.migrations.push({ name, up, down });
		return this;
	}

	public files(): SourceFile[] {
		const ids = this.migrations.map(
			(m, i) => `${timestamp(new Date(this.now.getTime() + i * 1000))}-${m.name}`,
		);
		return [
			...this.migrations.map((m, i) => ({
				filePath: `src/migrations/${ids[i]}.ts`,
				content: migrationFile(ids[i], m),
			})),
			{ filePath: "src/migrations/index.ts", content: indexFile(ids) },
		];
	}
}

function timestamp(at: Date): string {
	const two = (n: number) => String(n).padStart(2, "0");
	const date = `${at.getUTCFullYear()}${two(at.getUTCMonth() + 1)}${two(at.getUTCDate())}`;
	return `${date}-${two(at.getUTCHours())}${two(at.getUTCMinutes())}${two(at.getUTCSeconds())}`;
}

const statements = (sql: string[]) =>
	sql.map((statement) => `\t\tawait sql(${JSON.stringify(statement)});`).join("\n");

function migrationFile(id: string, m: SchemaMigration): string {
	return `import { defineMigration } from "@decohere/data";

export default defineMigration({
	id: ${JSON.stringify(id)},
	async up({ sql }) {
${statements(m.up)}
	},
	async down({ sql }) {
${statements(m.down)}
	},
});
`;
}

const identifier = (id: string) => `m${id.replaceAll("-", "_")}`;

function indexFile(ids: string[]): string {
	const imports = ids.map((id) => `import ${identifier(id)} from "./${id}.js";\n`).join("");
	return `// Written by the db commands: every migration in this folder, in id order.
import type { Migration } from "@decohere/data";
${imports}
export const migrations: Migration[] = [${ids.map(identifier).join(", ")}];
`;
}
