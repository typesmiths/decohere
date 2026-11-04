/**
 * Real-process benchmark for `flux run` on a one-line script, with the CLI built and installed
 * the way a user gets it. Not from source like the other flux suites: `tools/register.mjs` loads
 * the TypeScript compiler itself, so a from-source series could never show it coming back.
 *
 *   pnpm bench flux-run
 *   BENCH_SAMPLES=3 pnpm bench flux-run
 *
 * Builds the release packages into dist/release, then packs and installs the CLI in a temp folder.
 *
 * - `flux.run.cold`: compile cache and transpile cache both empty, as on a first run.
 * - `flux.run.warm`: the run after that, the everyday number.
 * - `flux.run.node`: `node` on the same script, to tell a slow runner from a slow flux.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { benchStats, samples } from "./harness.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = `console.log("Hello");\n`;

/** Builds and installs the CLI into `root`; returns the flux bin. */
function installCli(root: string): string {
	const env = { ...process.env, NODE_OPTIONS: "" };
	execFileSync(
		process.execPath,
		[
			"--import",
			path.join(repo, "tools/register.mjs"),
			path.join(repo, "projects/cli/src/forge.ts"),
			"build",
			"--configuration",
			"release",
		],
		{ cwd: repo, env, stdio: "ignore" },
	);
	const cliOut = path.join(repo, "dist/release/projects/cli");
	const tgz = path.join(root, "cli.tgz");
	execFileSync(
		process.execPath,
		[
			path.join(repo, "projects/create/pack-builder-tgz.mjs"),
			"--out-dir",
			cliOut,
			"--workspace-out",
			path.join(repo, "dist/release"),
			"--dest",
			tgz,
		],
		{ env, stdio: "ignore" },
	);
	// Packing installs into the build folder; publishing must not see that.
	rmSync(path.join(cliOut, "node_modules"), { recursive: true, force: true });
	rmSync(path.join(cliOut, "package-lock.json"), { force: true });
	const installed = path.join(root, "installed");
	mkdirSync(installed);
	execFileSync("tar", ["-xzf", tgz, "-C", installed]);
	return path.join(installed, "es6/src/flux.js");
}

/** Runs the command to its end and returns how long it took; a wrong run fails the suite. */
function timed(args: string[], cwd: string, env: NodeJS.ProcessEnv): number {
	const started = performance.now();
	const result = spawnSync(process.execPath, args, { cwd, env, encoding: "utf8" });
	const elapsed = performance.now() - started;
	if (result.status !== 0 || result.stdout !== "Hello\n") {
		throw new Error(`node ${args.join(" ")} failed:\n${result.stdout}${result.stderr}`);
	}
	return elapsed;
}

const root = mkdtempSync(path.join(tmpdir(), "flux-run-bench-"));
const cold: number[] = [];
const warm: number[] = [];
const node: number[] = [];
try {
	const flux = installCli(root);
	const app = path.join(root, "app");
	mkdirSync(app);
	writeFileSync(
		path.join(app, "package.json"),
		JSON.stringify({ name: "hello", version: "1.0.0", type: "module" }),
	);
	writeFileSync(
		path.join(app, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: { target: "es2022", module: "nodenext", strict: true },
		}),
	);
	writeFileSync(path.join(app, "hello.ts"), SCRIPT);
	writeFileSync(path.join(app, "hello.mjs"), SCRIPT);

	const compileCache = path.join(root, "compile-cache");
	const transpileCache = path.join(root, "transpile-cache");
	const env = {
		...process.env,
		NODE_OPTIONS: "",
		NODE_COMPILE_CACHE: compileCache,
		DECOHERE_CACHE_DIR: transpileCache,
	};
	for (let sample = 0; sample < samples; sample++) {
		rmSync(compileCache, { recursive: true, force: true });
		rmSync(transpileCache, { recursive: true, force: true });
		cold.push(timed([flux, "run", "hello.ts"], app, env));
		warm.push(timed([flux, "run", "hello.ts"], app, env));
		node.push(timed(["hello.mjs"], app, env));
	}
} finally {
	rmSync(root, { recursive: true, force: true });
}

benchStats.report([
	benchStats.summarize(
		"flux.run.cold",
		"flux run hello.ts, caches empty (installed CLI)",
		cold,
	),
	benchStats.summarize(
		"flux.run.warm",
		"flux run hello.ts, caches full (installed CLI)",
		warm,
	),
	benchStats.summarize("flux.run.node", "node on the same script, for comparison", node),
]);
