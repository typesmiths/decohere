import { parseArgs } from "node:util";
import type { IContainer } from "@decohere/core/composition";
import { DataConfigurationError } from "../error.js";
import { migrationFiles } from "./migration-files.js";
import { type MigrationTarget, MigrationTargetToken } from "./migration-target.js";

const USAGE = `Usage: db <command> [--data-source <name>]

  migrate [--to <id>] [--dry-run]   apply pending migrations, in id order
  status                            list migrations: applied, pending, or only in the history
  revert                            undo the last applied migration
  new <name> [--data]               write an empty migration (--data: one that changes rows)
  generate <name>                   write a schema migration from the mappings' differences`;

export type DbCommandOptions = {
	/** The migrations folder, ending in `/`: one for every data source, or one per data source name. */
	directory: URL | Record<string, URL>;
	/** Where the commands report. Defaults to stdout. */
	out?: (line: string) => void;
	now?: () => Date;
};

/** An app built but not started: `createApp()`. */
export type BuiltApp = { readonly services: IContainer };

export class DbCommandError extends Error {
	public override readonly name = "DbCommandError";
}

function pick(app: BuiltApp, name: string | undefined): MigrationTarget {
	const targets = app.services.resolveMany<MigrationTarget>(MigrationTargetToken);
	if (targets.length === 0) {
		throw new DataConfigurationError(
			"The app has no data sources with migrations. Give the provider its migrations: mikroOrm({ …, database: postgres, migrations }).",
		);
	}
	if (name != null) {
		const found = targets.find((t) => t.dataSource === name);
		if (found == null) {
			throw new DbCommandError(
				`No data source "${name}". The app's data sources: ${targets.map((t) => t.dataSource).join(", ")}`,
			);
		}
		return found;
	}
	if (targets.length > 1) {
		throw new DbCommandError(
			`The app has several data sources; name one with --data-source: ${targets.map((t) => t.dataSource).join(", ")}`,
		);
	}
	return targets[0];
}

function folder(options: DbCommandOptions, dataSource: string): URL {
	const { directory } = options;
	if (directory instanceof URL) return directory;
	const found = directory[dataSource];
	if (found == null) {
		throw new DbCommandError(
			`No migrations folder for data source "${dataSource}" in db's directory option`,
		);
	}
	return found;
}

function nameArgument(positionals: string[], command: string): string {
	const [name] = positionals;
	if (name == null)
		throw new DbCommandError(`db ${command} needs a name, such as add-expiry\n\n${USAGE}`);
	return name;
}

/**
 * The db commands, for an app's `db.ts`:
 *
 * ```ts
 * const app = await createApp();
 * try {
 * 	await db.run(app, process.argv.slice(2), { directory: new URL("./migrations/", import.meta.url) });
 * } finally {
 * 	await app.dispose();
 * }
 * ```
 *
 * Builds nothing and starts nothing itself: the app is built, not started, so no migration runs on
 * start and the server never listens.
 */
async function run(app: BuiltApp, argv: string[], options: DbCommandOptions): Promise<void> {
	const out = options.out ?? ((line: string) => process.stdout.write(`${line}\n`));
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			"data-source": { type: "string" },
			to: { type: "string" },
			"dry-run": { type: "boolean" },
			data: { type: "boolean" },
		},
	});
	const [command, ...rest] = positionals;
	if (command == null) throw new DbCommandError(USAGE);
	const target = pick(app, values["data-source"]);
	const container = app.services;

	switch (command) {
		case "migrate": {
			const applied = await target.migrator.migrate(target.source, {
				container,
				to: values.to,
				dryRun: values["dry-run"],
				log: out,
			});
			if (applied.length === 0) out("Nothing to apply");
			return;
		}
		case "revert": {
			const reverted = await target.migrator.revert(target.source, { container, log: out });
			if (reverted == null) out("Nothing to revert");
			return;
		}
		case "status": {
			for (const m of await target.migrator.status(target.source)) {
				const at = m.state === "pending" ? "" : `  ${m.appliedAt.toISOString()}`;
				const note = m.state === "unknown" ? "  (in the history, not in the code)" : "";
				out(`${m.state.padEnd(8)} ${m.id}${at}${note}`);
			}
			return;
		}
		case "new": {
			const name = nameArgument(rest, command);
			const now = options.now?.() ?? new Date();
			const file = values.data
				? await migrationFiles.writeData(folder(options, target.dataSource), name, now)
				: await migrationFiles.writeSchema(
						folder(options, target.dataSource),
						name,
						{ up: [], down: [] },
						now,
					);
			out(`Wrote ${file.pathname}`);
			return;
		}
		case "generate": {
			const name = nameArgument(rest, command);
			const pending = (await target.migrator.status(target.source)).filter(
				(m) => m.state === "pending",
			);
			if (pending.length > 0) {
				throw new DbCommandError(
					`Apply the pending migrations first (db migrate), or the diff repeats them: ${pending.map((m) => m.id).join(", ")}`,
				);
			}
			const diff = await target.diff();
			if (diff.up.length === 0) {
				out("The tables already match the mappings: nothing to write");
				return;
			}
			const file = await migrationFiles.writeSchema(
				folder(options, target.dataSource),
				name,
				diff,
				options.now?.() ?? new Date(),
			);
			out(`Wrote ${file.pathname}`);
			return;
		}
		default:
			throw new DbCommandError(`Unknown command ${JSON.stringify(command)}\n\n${USAGE}`);
	}
}

export const db = { run };
