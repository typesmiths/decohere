import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The Prettier the workspace pins, so the scaffolder formats as `pnpm run lint` will. */
function prettierOf(targetDir: string): string {
	const manifest = join(targetDir, "package.json");
	if (!existsSync(manifest)) return "prettier";
	const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
		devDependencies?: Record<string, string>;
	};
	const version = pkg.devDependencies?.prettier;
	return version == null ? "prettier" : `prettier@${version}`;
}

/**
 * Format the scaffolded files with Prettier.
 * Prefer a `prettier` on the PATH; fall back to `npx`. The scaffolder image doesn't use this.
 */
export function formatScaffoldedFiles(targetDir: string, paths: string[] = ["."]): void {
	process.stdout.write("\n  Formatting scaffolded files with Prettier...");
	const args = ["--write", "--ignore-unknown", ...paths];

	let result = spawnSync("prettier", args, {
		cwd: targetDir,
		encoding: "utf8",
		stdio: "pipe",
	});

	if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
		result = spawnSync("npx", ["--yes", prettierOf(targetDir), ...args], {
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
