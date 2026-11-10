import fs from "node:fs/promises";
import { DataConfigurationError } from "../error.js";
import type { SchemaDiff } from "./migrator.js";

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID_FILE = /^(\d{8}-\d{6}-[a-z0-9-]+)\.ts$/;

/** `20261110-093000-backfill-expiry`: the time in UTC, so ids from different machines sort together. */
function id(name: string, now: Date): string {
	if (!NAME.test(name)) {
		throw new DataConfigurationError(
			`A migration's name is lowercase words joined by dashes, such as add-expiry (got ${JSON.stringify(name)})`,
		);
	}
	const two = (n: number) => String(n).padStart(2, "0");
	const date = `${now.getUTCFullYear()}${two(now.getUTCMonth() + 1)}${two(now.getUTCDate())}`;
	const time = `${two(now.getUTCHours())}${two(now.getUTCMinutes())}${two(now.getUTCSeconds())}`;
	return `${date}-${time}-${name}`;
}

const statements = (sql: string[]) =>
	sql.map((statement) => `\t\tawait sql(${JSON.stringify(statement)});`).join("\n");

function schemaMigration(migrationId: string, diff: SchemaDiff): string {
	return `import { defineMigration } from "@decohere/data";

export default defineMigration({
	id: ${JSON.stringify(migrationId)},
	async up({ sql }) {
${statements(diff.up)}
	},
	async down({ sql }) {
${statements(diff.down)}
	},
});
`;
}

function dataMigration(migrationId: string): string {
	return `import { defineMigration } from "@decohere/data";

export default defineMigration({
	id: ${JSON.stringify(migrationId)},
	// Change rows a page at a time, so a big table never sits in memory. Each page must change its
	// rows so the select stops finding them. \`container\` resolves the app's services.
	//
	// async up({ sql, batch, container }) {
	// 	await batch(\`select id from thing where new_column is null order by id limit $1\`, 500, async (rows) => {
	// 		for (const { id } of rows) await sql(\`update thing set new_column = $1 where id = $2\`, [value, id]);
	// 	});
	// },
	async up() {
		throw new Error(${JSON.stringify(`Migration ${migrationId} is not written yet`)});
	},
});
`;
}

function identifier(migrationId: string): string {
	return `m${migrationId.replaceAll("-", "_")}`;
}

/** Lists every migration file in the folder, so the app imports them all and nothing is globbed at run time. */
async function writeIndex(directory: URL): Promise<void> {
	const ids = (await fs.readdir(directory))
		.map((file) => ID_FILE.exec(file)?.[1])
		.filter((found): found is string => found != null)
		.sort();
	const imports = ids.map((m) => `import ${identifier(m)} from "./${m}.js";\n`).join("");
	await fs.writeFile(
		new URL("index.ts", directory),
		`// Written by the db commands: every migration in this folder, in id order.
import type { Migration } from "@decohere/data";
${imports}
export const migrations: Migration[] = [${ids.map(identifier).join(", ")}];
`,
	);
}

async function write(directory: URL, migrationId: string, content: string): Promise<URL> {
	await fs.mkdir(directory, { recursive: true });
	const file = new URL(`${migrationId}.ts`, directory);
	await fs.writeFile(file, content, { flag: "wx" });
	await writeIndex(directory);
	return file;
}

/** Writes migration files and the folder's `index.ts`. `directory` is a folder URL, ending in `/`. */
export const migrationFiles = {
	id,
	writeIndex,
	/** A schema migration holding a provider's diff. */
	writeSchema(directory: URL, name: string, diff: SchemaDiff, now = new Date()) {
		return write(directory, id(name, now), schemaMigration(id(name, now), diff));
	},
	/** An empty data migration, to fill in by hand. */
	writeData(directory: URL, name: string, now = new Date()) {
		return write(directory, id(name, now), dataMigration(id(name, now)));
	},
};
