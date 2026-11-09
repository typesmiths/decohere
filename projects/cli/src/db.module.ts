import type { WorkspaceFactoryOptions } from "@decohere/devkit/cli";
import { ModuleManifest } from "@decohere/devkit/cli";
import { createWorkspace } from "@decohere/forge/transpile";
import { DbAction } from "./db.action.js";
import { DbCommand } from "./db.command.js";

/** `decohere db`: an API's migrations, from the workspace. */
export class DbModule extends ModuleManifest {
	public readonly id = "db";
	public readonly command = DbCommand;
	public readonly actions = { db: DbAction };

	public override createWorkspace(options: WorkspaceFactoryOptions) {
		// The workspace flux compiles with, so db.ts runs as `flux run` would run it.
		return createWorkspace(options);
	}
}
