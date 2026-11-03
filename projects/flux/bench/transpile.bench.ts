/**
 * Transpile benchmark: SWC time alone, for the ways flux could compile a workspace.
 * Uses the options flux builds for a project, with the sources already in memory, so file reads,
 * resolution and module evaluation are left out.
 *
 *   pnpm bench flux-transpile
 *   BENCH_LIBS=4 BENCH_FILES=100 BENCH_SAMPLES=5 pnpm bench flux-transpile
 *
 * - `sync-inline`: one file at a time with inline source maps, as the load hook does today.
 * - `sync-separate`: the same, with the map returned as its own string instead of inlined.
 * - `sync-none`: no source map at all; the floor for a sync compile.
 * - `parallel-inline`: every file at once through async `transform`, on SWC's thread pool.
 *
 * The strategies take turns within each round, so a slow moment on the machine hits them all.
 * These are warm numbers (round 0 is discarded): in a fresh process the first round is slower,
 * and SWC inside a real cold load costs more again (`flux.load.cold.swc`). Use this suite to
 * compare strategies, and flux-load for what a start actually pays.
 */
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BuildTargets, createWorkspace, SwcTranspiler } from "@decohere/forge";
import { type Options, transform, transformSync } from "@swc/core";
import { benchStats, benchWorkspace, samples as runs } from "./harness.js";

type Source = { fullPath: string; code: string };
type Strategy = {
	id: string;
	label: string;
	run: (sources: Source[]) => Promise<void> | void;
};

/** The options flux's loader builds for a project (`SourceModuleLoader.swcConfigFor`). */
async function fluxOptions(root: string): Promise<{ options: Options; sources: Source[] }> {
	const workspace = await createWorkspace({ rootDir: root });
	const projects = workspace.getProjects("debug");
	const project = projects[0];
	if (project == null) throw new Error(`no projects found under ${root}`);
	const base = new SwcTranspiler().createBaseConfig(BuildTargets.es6, {
		tsConfig: project.getTsConfigSync(),
		userConfig: project.getSwcConfigSync(),
		aliasPaths: false,
		workspace,
	});
	const module = { ...base.module, resolveFully: false } as Options["module"];
	const files = (await Promise.all(projects.map((p) => p.getAllFiles()))).flat();
	const sources = files.map((file) => ({
		fullPath: file.fullPath,
		code: readFileSync(file.fullPath, "utf8"),
	}));
	workspace[Symbol.dispose]();
	return { options: { ...base, module }, sources };
}

function strategies(options: Options): Strategy[] {
	const withMaps = (sourceMaps: Options["sourceMaps"]) => (source: Source) =>
		({ ...options, filename: source.fullPath, sourceMaps }) satisfies Options;
	const sync = (sourceMaps: Options["sourceMaps"]) => (sources: Source[]) => {
		const optionsFor = withMaps(sourceMaps);
		for (const source of sources) transformSync(source.code, optionsFor(source));
	};
	return [
		{
			id: "flux.transpile.sync-inline",
			label: "transpile (warm), one file at a time, inline maps (today)",
			run: sync("inline"),
		},
		{
			id: "flux.transpile.sync-separate",
			label: "transpile (warm), one file at a time, separate maps",
			run: sync(true),
		},
		{
			id: "flux.transpile.sync-none",
			label: "transpile (warm), one file at a time, no maps",
			run: sync(false),
		},
		{
			id: "flux.transpile.parallel-inline",
			label: "transpile (warm), all files in parallel, inline maps",
			run: async (sources) => {
				const optionsFor = withMaps("inline");
				await Promise.all(sources.map((source) => transform(source.code, optionsFor(source))));
			},
		},
	];
}

const root = mkdtempSync(path.join(tmpdir(), "flux-transpile-bench-"));
try {
	benchWorkspace.generate(root);
	const { options, sources } = await fluxOptions(root);
	const all = strategies(options);
	const timings = new Map<string, number[]>(all.map((s) => [s.id, []]));
	// Round 0 warms up SWC's binding and thread pool and is not recorded.
	for (let round = 0; round <= runs; round++) {
		for (const strategy of all) {
			const started = performance.now();
			await strategy.run(sources);
			const elapsed = performance.now() - started;
			if (round > 0) timings.get(strategy.id)?.push(elapsed);
		}
	}
	benchStats.report(
		all.map((s) =>
			benchStats.summarize(s.id, s.label, timings.get(s.id) ?? [], sources.length),
		),
	);
} finally {
	rmSync(root, { recursive: true, force: true });
}
