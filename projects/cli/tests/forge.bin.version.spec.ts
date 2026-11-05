import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// CI stamps a dev version once, from the commit and its run number, and Publish copies that
// version from the build. Both used to read git tags at different times: a merge landing between
// them built one version and published another, which npm then skipped as already published.
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { tmpdir } = await vi.importActual<typeof import("node:os")>("node:os");
const { join } = await vi.importActual<typeof import("node:path")>("node:path");

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const dir = realFs.mkdtempSync(join(tmpdir(), "decohere-forge-version-"));

// 23:30 at UTC-5 is already the 5th in UTC.
const COMMIT_DATE = "2026-11-04T23:30:00-05:00";
const UTC_DAY = "20261105";

function write(relativePath: string, value: unknown) {
	const file = join(dir, relativePath);
	realFs.mkdirSync(join(file, ".."), { recursive: true });
	realFs.writeFileSync(file, JSON.stringify(value));
}

function versionOf(relativePath: string): string {
	return JSON.parse(realFs.readFileSync(join(dir, relativePath), "utf8")).version;
}

function git(...args: string[]) {
	const result = spawnSync("git", args, {
		cwd: dir,
		encoding: "utf8",
		env: {
			...process.env,
			GIT_AUTHOR_NAME: "test",
			GIT_AUTHOR_EMAIL: "test@example.invalid",
			GIT_COMMITTER_NAME: "test",
			GIT_COMMITTER_EMAIL: "test@example.invalid",
			GIT_COMMITTER_DATE: COMMIT_DATE,
		},
	});
	expect(result.status, result.stderr).toBe(0);
}

// Not spawnSync: blocking the test worker for this many runs makes Vitest's own calls time out.
function forgeVersion(...args: string[]) {
	return new Promise<{ status: number | null; stdout: string; stderr: string }>(
		(resolve, reject) => {
			const child = spawn(
				process.execPath,
				[
					"--import",
					join(repo, "tools/register.mjs"),
					join(repo, "projects/cli/src/forge.ts"),
					"version",
					...args,
				],
				{ cwd: dir, timeout: 60_000 },
			);
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", (chunk) => (stdout += chunk));
			child.stderr.on("data", (chunk) => (stderr += chunk));
			child.on("error", reject);
			child.on("close", (status) => resolve({ status, stdout, stderr }));
		},
	);
}

function built(versions: { a: string; b: string }) {
	write("dist/release/projects/a/package.json", { name: "a", version: versions.a });
	write("dist/release/projects/b/package.json", { name: "b", version: versions.b });
}

describe("forge version (real process)", () => {
	beforeEach(() => {
		realFs.rmSync(dir, { recursive: true, force: true });
		realFs.mkdirSync(dir);
		write("package.json", { name: "root", version: "1.2.3-dev.5", type: "module" });
		write("projects/a/package.json", { name: "a", version: "1.2.3-dev.5" });
		write("projects/b/package.json", { name: "b", version: "1.2.3-dev.5" });
		git("init", "-q");
		git("add", ".");
		git("commit", "-q", "-m", "init");
	});

	afterAll(() => {
		realFs.rmSync(dir, { recursive: true, force: true });
	});

	describe("--build-number", () => {
		it("stamps every package with the commit's UTC date and the number", async () => {
			const result = await forgeVersion("--channel", "dev", "--build-number", "512");

			expect(result.status, result.stdout + result.stderr).toBe(0);
			const expected = `1.2.3-dev.${UTC_DAY}.512`;
			expect(versionOf("package.json")).toBe(expected);
			expect(versionOf("projects/a/package.json")).toBe(expected);
			expect(versionOf("projects/b/package.json")).toBe(expected);
		});

		it("gives the same version when run again, whatever the tags say", async () => {
			await forgeVersion("--channel", "dev", "--build-number", "512");
			git("tag", "v9.9.9-dev.1");

			await forgeVersion("--channel", "dev", "--build-number", "512");

			expect(versionOf("package.json")).toBe(`1.2.3-dev.${UTC_DAY}.512`);
		});

		it.each(["0", "abc", "007"])("refuses %s as a number", async (value) => {
			const result = await forgeVersion("--channel", "dev", `--build-number=${value}`);

			expect(result.status).toBe(1);
			expect(result.stdout + result.stderr).toContain(value);
			expect(versionOf("package.json")).toBe("1.2.3-dev.5");
		});
	});

	describe("--from-build", () => {
		it("copies the version from the built packages to the source", async () => {
			built({ a: "1.2.3-dev.20261105.512", b: "1.2.3-dev.20261105.512" });

			const result = await forgeVersion("--from-build");

			expect(result.status, result.stdout + result.stderr).toBe(0);
			expect(versionOf("package.json")).toBe("1.2.3-dev.20261105.512");
			expect(versionOf("projects/a/package.json")).toBe("1.2.3-dev.20261105.512");
		});

		it("fails, naming both versions, when the built packages disagree", async () => {
			built({ a: "1.2.3-dev.20261105.512", b: "1.2.3-dev.20261105.513" });

			const result = await forgeVersion("--from-build");

			expect(result.status).toBe(1);
			expect(result.stdout + result.stderr).toContain("1.2.3-dev.20261105.512");
			expect(result.stdout + result.stderr).toContain("1.2.3-dev.20261105.513");
			expect(versionOf("package.json")).toBe("1.2.3-dev.5");
		});

		it("fails when a package has no build", async () => {
			write("dist/release/projects/a/package.json", { name: "a", version: "1.2.3-dev.1" });

			const result = await forgeVersion("--from-build");

			expect(result.status).toBe(1);
			expect(result.stdout + result.stderr).toContain(join("dist/release/projects/b"));
			expect(versionOf("package.json")).toBe("1.2.3-dev.5");
		});
	});

	it("refuses --build-number together with --from-build", async () => {
		built({ a: "1.2.3-dev.1", b: "1.2.3-dev.1" });

		const result = await forgeVersion("--from-build", "--build-number", "512");

		expect(result.status).toBe(1);
		expect(result.stdout + result.stderr).toContain("not both");
		expect(versionOf("package.json")).toBe("1.2.3-dev.5");
	});
}, 180_000);
