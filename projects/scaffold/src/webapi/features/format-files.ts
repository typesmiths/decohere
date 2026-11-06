import { spawnSync } from "node:child_process";
import { PRETTIER_VERSION } from "../../models/package-json.model.js";

/**
 * Format the scaffolded files with Prettier.
 * Prefer a `prettier` on the PATH; fall back to `npx`. The scaffolder image doesn't use this.
 */
export function formatScaffoldedFiles(targetDir: string, paths: string[] = ["."]): void {
	process.stdout.write("\n  Formatting scaffolded files with Prettier...");

	let result = spawnSync("prettier", ["--write", ...paths], {
		cwd: targetDir,
		encoding: "utf8",
		stdio: "pipe",
	});

	if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
		result = spawnSync("npx", ["--yes", `prettier@${PRETTIER_VERSION}`, "--write", ...paths], {
			cwd: targetDir,
			encoding: "utf8",
			stdio: "pipe",
		});
	}

	if (result.status === 0) {
		process.stdout.write(" done.\n");
		return;
	}

	const detail = (result.stderr || result.stdout || result.error?.message || "").trim();
	process.stdout.write(" failed.\n");
	if (detail) {
		console.error(`  ✗ Prettier: ${detail.slice(0, 400)}`);
	}
}
