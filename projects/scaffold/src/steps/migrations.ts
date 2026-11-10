import type { WorkspaceChanges } from "../templates/workspace-changes.js";

const identifier = (id: string) => `m${id.replaceAll("-", "_")}`;

/**
 * Writes an app's `src/migrations/index.ts` as the db commands do: every migration in the folder,
 * in id order. So a step that adds a migration lists it beside the app's own.
 */
function writeIndex(changes: WorkspaceChanges, app: string): void {
	const dir = `projects/${app}/src/migrations`;
	const ids = changes
		.listFiles(dir)
		.filter((file) => /^\d{8}-\d{6}-.+\.ts$/.test(file))
		.map((file) => file.slice(0, -".ts".length));
	if (ids.length === 0) return;
	const imports = ids.map((id) => `import ${identifier(id)} from "./${id}.js";\n`).join("");
	changes.write(
		`${dir}/index.ts`,
		`// Written by the db commands: every migration in this folder, in id order.
import type { Migration } from "@decohere/data";
${imports}
export const migrations: Migration[] = [${ids.map(identifier).join(", ")}];
`,
	);
}

export const migrations = { writeIndex };
