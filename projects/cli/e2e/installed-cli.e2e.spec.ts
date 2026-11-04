/**
 * E2e: packs @decohere/cli from dist/release with real `npm install`, unpacks it outside the
 * repo so nothing resolves from the repo's node_modules, and runs the bins on a new project.
 * Catches what running from source can't: a dependency missing from a package's manifest, a
 * subpath missing from `exports`, a file left out of the build.
 *
 * Requires `pnpm forge build --configuration release`.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const cliOut = resolve(repo, "dist/release/projects/cli");
const root = mkdtempSync(join(tmpdir(), "decohere-installed-cli-"));
const installed = join(root, "installed");
const app = join(root, "app");

const SOURCE = `enum Level {
	Info = "info",
}
function tag(_target: unknown, _key: string | symbol | undefined, _index: number) {}
class App {
	public constructor(@tag private readonly name: string) {}
	public greet(): string {
		return \`[\${Level.Info}] Hello, \${this.name}!\`;
	}
}
console.log(new App("Ada").greet());
`;

function bin(name: "flux" | "forge", ...args: string[]) {
	return spawnSync(process.execPath, [join(installed, "es6/src", `${name}.js`), ...args], {
		cwd: app,
		encoding: "utf8",
		timeout: 60_000,
	});
}

describe("the CLI installed from its packed packages (real process)", () => {
	beforeAll(() => {
		if (!existsSync(cliOut)) {
			throw new Error(`${cliOut} is missing: run pnpm forge build --configuration release`);
		}
		const tgz = join(root, "cli.tgz");
		execFileSync(process.execPath, [
			join(repo, "projects/create/pack-builder-tgz.mjs"),
			"--out-dir",
			cliOut,
			"--workspace-out",
			resolve(repo, "dist/release"),
			"--dest",
			tgz,
		]);
		// Packing installs into the build folder; publishing must not see that.
		rmSync(join(cliOut, "node_modules"), { recursive: true, force: true });
		rmSync(join(cliOut, "package-lock.json"), { force: true });
		mkdirSync(installed);
		execFileSync("tar", ["-xzf", tgz, "-C", installed]);

		mkdirSync(join(app, "src"), { recursive: true });
		writeFileSync(
			join(app, "package.json"),
			JSON.stringify({ name: "solo", version: "1.0.0", type: "module" }),
		);
		writeFileSync(join(app, "src/index.ts"), SOURCE);
	}, 300_000);

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it("flux run runs a file Node's own type stripping can't", () => {
		const result = bin("flux", "run", "src/index.ts");

		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toBe("[info] Hello, Ada!\n");
	});

	it("forge build compiles the project", () => {
		const result = bin("forge", "build");

		expect(result.status, result.stderr).toBe(0);
		expect(existsSync(join(app, "dist/debug/src/index.js")), result.stdout).toBe(true);
	});

	it("forge typecheck passes the same file", () => {
		const result = bin("forge", "typecheck");

		expect(result.status, result.stdout + result.stderr).toBe(0);
	});
});
