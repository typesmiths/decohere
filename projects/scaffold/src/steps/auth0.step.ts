import { templates } from "../templates/templates.js";
import type { WorkspaceChanges } from "../templates/workspace-changes.js";
import { appSource, type SourceEdit } from "./app-source.js";
import type { AppTarget } from "./apps.js";

const AUTH_IMPORT = 'import { auth } from "@decohere/http";';

/** `.use(auth())` right after the config plugin, which it reads its settings from. */
const authEdit: SourceEdit = {
	imports: [AUTH_IMPORT],
	isDone: (source) => source.includes(".use(auth("),
	apply: appSource.insertAfter(/^[ \t]*\.use\(config\(.*\)\)[ \t]*$/, ".use(auth())"),
	byHand: ["and call .use(auth()) on the builder, after .use(config(…)) and before .build()."],
};

/**
 * `decohere add auth0`: every route needs a token unless it has `@AllowAnonymous()`. Writes the
 * values for `.env` that setting up Auth0 returned, and wires `auth()` into each app. The Hello
 * controller and its test are replaced only if they are still the recipe's.
 */
function apply(
	changes: WorkspaceChanges,
	workspace: string,
	targets: AppTarget[],
	env: Record<string, string>,
): void {
	changes.write(".env", upsertEnv(changes.read(".env") ?? "", env));
	for (const { name: app, port } of targets) {
		templates.apply(
			changes,
			"steps/auth0",
			{ workspace, app, port },
			{
				replaces: ["recipes/webapi"],
			},
		);
		appSource.edit(changes, app, [authEdit]);
	}
}

/** `.env` with these values set, replacing any it had. */
function upsertEnv(text: string, entries: Record<string, string>): string {
	let result = text;
	for (const [key, value] of Object.entries(entries)) {
		const line = new RegExp(`^${key}=.*$`, "m");
		result = line.test(result)
			? result.replace(line, `${key}=${value}`)
			: `${result}${result === "" || result.endsWith("\n") ? "" : "\n"}${key}=${value}\n`;
	}
	return result;
}

export const auth0Step = { apply, upsertEnv };
