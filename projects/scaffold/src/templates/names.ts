import { CREATE_VERSION, DEVCONTAINER_IMAGE_REPOSITORY } from "../version.js";

/** What a template's placeholders stand for in one workspace, for one of its apps. */
export type Names = {
	/** The workspace (project) name, e.g. `my-app`. */
	workspace: string;
	/** The app's folder under `projects/`, e.g. `api`. */
	app: string;
	/** The app's local port. */
	port: number;
};

/** A name as a Postgres identifier: `my-app` → `my_app`. */
function toSqlIdentifier(name: string): string {
	const cleaned = name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^([^A-Za-z_])/, "p_$1");
	return cleaned.length > 0 ? cleaned.slice(0, 40) : "app";
}

/** An app's prefix for its environment variables: `admin-api` → `ADMIN_API`. */
function toEnvPrefix(app: string): string {
	return app.replace(/-/g, "_").toUpperCase();
}

/**
 * Template files are working code with stand-in names. These are replaced in each file's path
 * and text, longest first, so `workspace_name_app_name_dev` becomes `my_app_api_dev`.
 */
function placeholders(names: Names): [string, string][] {
	return [
		["decohere-devcontainer-image", `${DEVCONTAINER_IMAGE_REPOSITORY}:${CREATE_VERSION}`],
		["workspace-name", names.workspace],
		["workspace_name", toSqlIdentifier(names.workspace)],
		["app-name", names.app],
		["app_name", toSqlIdentifier(names.app)],
		["APP_NAME", toEnvPrefix(names.app)],
		["app-port", String(names.port)],
	];
}

function substitute(text: string, names: Names): string {
	let result = text;
	for (const [placeholder, value] of placeholders(names)) {
		result = result.replaceAll(placeholder, value);
	}
	return result;
}

export const templateNames = { substitute, toEnvPrefix };
