/**
 * E2e: spawns the real scaffold Docker container and drives it through
 * interactive prompts via stdin. No mocks. Asserts the scaffolded tree on a
 * host-mounted volume (not only exit / Done!).
 *
 * Requires the create image (CI tags `:local` from `forge docker --dry-run`):
 *   node projects/create/pack-builder-tgz.mjs \
 *     --out-dir dist/release/projects/scaffold \
 *     --workspace-out dist/release \
 *     --dest projects/create/create.tgz
 *   docker build -f projects/create/Dockerfile \
 *     --build-arg CREATE_VERSION=local \
 *     -t ghcr.io/typesmiths/decohere/create:local \
 *     projects/create
 *
 * Missing image fails the suite (no silent skip).
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const IMAGE = "ghcr.io/typesmiths/decohere/create:local";
const PROMPT = "  > ";
const CONTAINER_OUT = "/scaffold-out";

function imageExists(image: string): boolean {
	try {
		execFileSync("docker", ["image", "inspect", image], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}

function hostUser(): string[] {
	const uid = process.getuid?.();
	const gid = process.getgid?.();
	if (uid == null || gid == null) return [];
	// Write as the host user so afterEach can rm the bind mount (CI: root-owned files → EACCES).
	return ["--user", `${uid}:${gid}`];
}

function rmHostDir(dir: string): void {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code !== "EACCES") throw err;
		execFileSync(
			"docker",
			[
				"run",
				"--rm",
				"--entrypoint",
				"rm",
				"-v",
				`${dir}:/rm-target`,
				IMAGE,
				"-rf",
				"/rm-target/.",
			],
			{ stdio: "ignore" },
		);
		rmSync(dir, { recursive: true, force: true });
	}
}

/**
 * Spawns the scaffold container with `hostDir` mounted at CONTAINER_OUT, feeds
 * `answers` in order each time the `  > ` readline prompt appears in stdout,
 * then resolves with the combined output and exit code.
 */
function runInContainer(
	answers: string[],
	hostDir: string,
): Promise<{ output: string; exitCode: number }> {
	return new Promise((resolve, reject) => {
		const proc = spawn(
			"docker",
			[
				"run",
				"--rm",
				"-i",
				...hostUser(),
				"-v",
				`${hostDir}:${CONTAINER_OUT}`,
				"-e",
				"DECOHERE_BUILDER=1",
				"-e",
				"HOME=/tmp/decohere-create-home",
				IMAGE,
				"create",
				"webapi",
				"-d",
				CONTAINER_OUT,
			],
			{ stdio: ["pipe", "pipe", "pipe"] },
		);

		let output = "";
		const remaining = [...answers];

		const tryAnswer = () => {
			const idx = output.indexOf(PROMPT);
			if (idx === -1 || remaining.length === 0) return;
			// Consume this prompt position so we don't re-trigger on buffered output.
			output = output.slice(0, idx) + output.slice(idx + PROMPT.length);
			const answer = remaining.shift();
			if (answer == null) return;
			proc.stdin.write(`${answer}\n`);
			if (remaining.length === 0) proc.stdin.end();
		};

		proc.stdout.on("data", (chunk: Buffer) => {
			output += chunk.toString();
			tryAnswer();
		});
		proc.stderr.on("data", (chunk: Buffer) => {
			output += chunk.toString();
		});

		proc.on("close", (code) => resolve({ output, exitCode: code ?? 0 }));
		proc.on("error", reject);
	});
}

function expectScaffoldTree(root: string): void {
	expect(existsSync(join(root, "package.json")), `${root}/package.json`).toBe(true);
	expect(
		existsSync(join(root, "projects/api/Dockerfile")),
		`${root}/projects/api/Dockerfile`,
	).toBe(true);
	expect(
		existsSync(join(root, "projects/api/package.json")),
		`${root}/projects/api/package.json`,
	).toBe(true);
	expect(
		existsSync(join(root, "projects/api/src/main.ts")),
		`${root}/projects/api/src/main.ts`,
	).toBe(true);

	const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
		scripts?: Record<string, string>;
	};
	expect(pkg.scripts?.build, "root package.json scripts.build").toBeTruthy();
	expect(pkg.scripts?.start, "root package.json scripts.start").toBeTruthy();
	expect(pkg.scripts?.dev, "root package.json scripts.dev").toBeTruthy();
}

describe("scaffold docker integration", () => {
	let mountDir: string | undefined;

	afterEach(() => {
		if (mountDir != null) {
			rmHostDir(mountDir);
			mountDir = undefined;
		}
	});

	it("scaffolds a webapi project with no database, no auth, and no postman", async () => {
		expect(
			imageExists(IMAGE),
			`Missing image ${IMAGE}. Build it before e2e:\n` +
				"  node projects/create/pack-builder-tgz.mjs \\\n" +
				"    --out-dir dist/release/projects/scaffold \\\n" +
				"    --workspace-out dist/release \\\n" +
				"    --dest projects/create/create.tgz\n" +
				"  docker build -f projects/create/Dockerfile \\\n" +
				"    --build-arg CREATE_VERSION=local \\\n" +
				"    -t ghcr.io/typesmiths/decohere/create:local \\\n" +
				"    projects/create",
		).toBe(true);

		mountDir = mkdtempSync(join(tmpdir(), "decohere-scaffold-e2e-"));

		const { output, exitCode } = await runInContainer(
			[
				"1", // Database: none (option 1)
				"1", // Auth provider: none (option 1)
				"1", // Postman: none (option 1)
				// No install prompt — DECOHERE_BUILDER=1 skips it
			],
			mountDir,
		);

		expect(exitCode, `Container exited non-zero.\nOutput:\n${output}`).toBe(0);
		expect(output, "Expected 'Done!' in output").toContain("Done!");
		expectScaffoldTree(mountDir);
	}, 120_000);
});
