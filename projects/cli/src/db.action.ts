import { existsSync } from "node:fs";
import path from "node:path";
import { injectable } from "@decohere/crucible/decorators";
import { type Action, ActionResponse } from "@decohere/devkit/cli";
import { flux } from "@decohere/flux";
import { Workspace } from "@decohere/workspace";

export type DbOptions = {
	/** The API whose db.ts runs: its folder name or package name. Needed when several have one. */
	api?: string;
	/** The db command and its options, passed to db.ts as they were typed. */
	args: string[];
};

/** Where an app keeps its db commands. */
const DB_ENTRY = path.join("src", "db.ts");

type Api = { folder: string; packageName: string; entry: string };

/** `decohere db`: runs an API's own `src/db.ts` from source, with the rest of the command line. */
@injectable()
export class DbAction implements Action<DbOptions> {
	public constructor(private readonly workspace: Workspace) {}

	public async run(options: DbOptions): Promise<ActionResponse> {
		const picked = pickApi(this.apis(), options.api);
		if (typeof picked === "string") return ActionResponse.Error(DbAction.name, picked);
		try {
			await flux.run(picked.entry, { args: options.args, workspace: this.workspace });
		} catch (err) {
			// db.ts disposes its app on the way out, and that stops scribe, which this CLI logs
			// through too. So the error goes to stderr here, or nobody would see it.
			console.error(describe(err));
			return ActionResponse.Error(DbAction.name, `${DB_ENTRY} failed`);
		}
		return ActionResponse.Success(DbAction.name);
	}

	private apis(): Api[] {
		return this.workspace
			.getProjects("debug")
			.map((project) => ({
				folder: path.basename(project.projectRoot),
				packageName: project.name,
				entry: path.join(project.projectRoot, DB_ENTRY),
			}))
			.sort((a, b) => a.folder.localeCompare(b.folder));
	}
}

/**
 * A db command's own refusal (`DbCommandError`: usage, pending migrations, no such data source)
 * is written for the developer, so its message is enough. Anything else, such as a migration that
 * failed, keeps its stack and cause.
 */
function describe(err: unknown): unknown {
	return err instanceof Error && err.name === "DbCommandError" ? err.message : err;
}

/** The API to run, or why there isn't one. */
function pickApi(projects: Api[], name: string | undefined): Api | string {
	const apis = projects.filter((p) => existsSync(p.entry));
	const list = apis.map((a) => a.folder).join(", ");
	if (name != null) {
		const named = projects.find((p) => p.folder === name || p.packageName === name);
		if (named == null) return `No project named ${name} in this workspace.`;
		if (!apis.includes(named)) {
			return `${name} has no ${DB_ENTRY}.${list ? ` Projects with one: ${list}.` : ""}`;
		}
		return named;
	}
	if (apis.length === 1) return apis[0];
	if (apis.length === 0) return `No project in this workspace has a ${DB_ENTRY}.`;
	return `Several projects have a ${DB_ENTRY}: ${list}. Name one with --api <name>.`;
}
