import { Templates } from "../templates/templates.service.js";
import type { WorkspaceChanges } from "../templates/workspace-changes.model.js";
import { AppSource, type SourceEdit } from "./app-source.model.js";
import { type AppTarget, WorkspaceApp } from "./workspace-app.model.js";

const AUTH_IMPORT = 'import { auth } from "@decohere/http";';

/** `.use(auth())` right after the config plugin, which it reads its settings from. */
const authEdit: SourceEdit = {
	imports: [AUTH_IMPORT],
	isDone: (source) => source.includes(".use(auth("),
	apply: AppSource.insertAfter(/^[ \t]*\.use\(config\(.*\)\)[ \t]*$/, ".use(auth())"),
	byHand: ["and call .use(auth()) on the builder, after .use(config(…)) and before .build()."],
};

/**
 * `decohere add auth0`: every route needs a token unless it has `@AllowAnonymous()`. Writes the
 * values for `.env` that setting up Auth0 returned, and wires `auth()` into each app. The Hello
 * controller and its test are replaced only if they are still the recipe's.
 */
export class Auth0Step {
	public constructor(
		private readonly changes: WorkspaceChanges,
		private readonly templates = new Templates(),
	) {}

	public apply(workspace: string, targets: AppTarget[], env: Record<string, string>): void {
		this.changes.setEnv(env);
		for (const { name: app, port } of targets) {
			this.templates.apply(
				this.changes,
				"steps/auth0",
				{ workspace, app, port },
				{ replaces: ["recipes/webapi"] },
			);
			new WorkspaceApp(this.changes, app).source.edit([authEdit]);
		}
	}
}
