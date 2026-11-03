import { spawnSync } from "node:child_process";

/**
 * Format/lint-fix all files in the scaffolded workspace with Biome.
 * Prefer a global `biome` binary (builder image); fall back to `npx`.
 */
export function formatScaffoldedFiles(targetDir: string, paths: string[] = ["."]): void {
	process.stdout.write("\n  Formatting scaffolded files with Biome...");

	let result = spawnSync("biome", ["check", "--write", ...paths], {
		cwd: targetDir,
		encoding: "utf8",
		stdio: "pipe",
	});

	if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
		result = spawnSync("npx", ["--yes", "@biomejs/biome", "check", "--write", ...paths], {
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
		console.error(`  ✗ Biome: ${detail.slice(0, 400)}`);
	}
}
