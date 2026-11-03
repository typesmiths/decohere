/**
 * Shared pieces of the flux benchmarks: the generated workspace they all run against, the
 * statistics, and the result line `pnpm bench` reads (projects/ci-tools/src/bench/bench.mjs).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** One benchmark's result, in the shape every suite reports. */
export type BenchResult = {
	/** Stable key, e.g. `flux.load.cold`; history and charts are keyed by it. */
	id: string;
	label: string;
	unit: "ms";
	median: number;
	p90: number;
	min: number;
	max: number;
	samples: number;
	/** Source files the benchmark compiled or loaded, when that is what it scales with. */
	files?: number;
};

/** Printed before the JSON array of results, so the runner can find it among other output. */
export const RESULT_PREFIX = "BENCH_RESULT ";

/**
 * Samples per benchmark, the same for every suite so results are comparable: one per process
 * for the process benchmarks, one per round for the in-process ones.
 */
export const samples = Number(process.env.BENCH_SAMPLES ?? 10);

export type WorkspaceShape = { libs: number; filesPerLib: number };

export const defaultShape: WorkspaceShape = {
	libs: Number(process.env.BENCH_LIBS ?? 8),
	filesPerLib: Number(process.env.BENCH_FILES ?? 40),
};

function write(file: string, content: string) {
	mkdirSync(path.dirname(file), { recursive: true });
	writeFileSync(file, content);
}

/**
 * Writes a workspace whose files import each other the way an app's do: each library re-exports
 * a `models/` directory through its index (a directory import), each model imports the previous
 * one (relative, with `.js`) and the previous library by package name, and has a decorated class.
 * Returns the last library's index, which imports everything.
 */
function generate(root: string, shape: WorkspaceShape = defaultShape): string {
	write(
		path.join(root, "package.json"),
		JSON.stringify({ name: "flux-bench", type: "module" }),
	);
	write(
		path.join(root, "tsconfig.json"),
		JSON.stringify({ compilerOptions: { experimentalDecorators: true } }),
	);
	for (let lib = 0; lib < shape.libs; lib++) {
		const dir = path.join(root, "projects", `lib-${lib}`);
		write(
			path.join(dir, "package.json"),
			JSON.stringify({ name: `@bench/lib-${lib}`, type: "module", main: "src/index.ts" }),
		);
		const previousLib = lib > 0 ? `@bench/lib-${lib - 1}` : null;
		write(path.join(dir, "src/index.ts"), `export * from "./models";\n`);
		const exports: string[] = [];
		for (let file = 0; file < shape.filesPerLib; file++) {
			write(modelPath(root, lib, file), modelSource(lib, file, previousLib));
			exports.push(`export * from "./model-${file}.js";`);
		}
		write(path.join(dir, "src/models/index.ts"), `${exports.join("\n")}\n`);
	}
	return path.join(root, "projects", `lib-${shape.libs - 1}`, "src/index.ts");
}

function modelPath(root: string, lib: number, file: number): string {
	return path.join(root, "projects", `lib-${lib}`, "src/models", `model-${file}.ts`);
}

/** `revision` changes the file's text without changing what it exports, to trigger a reload. */
function modelSource(lib: number, file: number, previousLib: string | null, revision = 0) {
	const name = `Model${lib}x${file}`;
	const previous = file > 0 ? `Model${lib}x${file - 1}` : null;
	return [
		previous ? `import { ${previous} } from "./model-${file - 1}.js";` : "",
		previousLib && file === 0 ? `import { Model${lib - 1}x0 } from "${previousLib}";` : "",
		`const tag = (_target: unknown) => {};`,
		`@tag`,
		`export class ${name} {`,
		`\tpublic readonly id: number = ${file};`,
		`\tpublic readonly revision: number = ${revision};`,
		`\tpublic constructor(public readonly label: string = "${name}") {}`,
		`\tpublic describe(): string { return \`\${this.label}:\${this.id}\`; }`,
		previous ? `\tpublic previous = ${previous};` : "",
		previousLib && file === 0 ? `\tpublic upstream = Model${lib - 1}x0;` : "",
		`}`,
	]
		.filter(Boolean)
		.join("\n");
}

/** Rewrites one model with a new revision, as an editor save would. */
function touchModel(root: string, lib: number, file: number, revision: number) {
	const previousLib = lib > 0 ? `@bench/lib-${lib - 1}` : null;
	writeFileSync(modelPath(root, lib, file), modelSource(lib, file, previousLib, revision));
}

function percentile(values: readonly number[], fraction: number): number {
	if (values.length === 0) return Number.NaN;
	const sorted = [...values].sort((a, b) => a - b);
	const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
	return sorted[Math.max(0, index)] ?? Number.NaN;
}

function summarize(
	id: string,
	label: string,
	values: readonly number[],
	files?: number,
): BenchResult {
	return {
		id,
		label,
		unit: "ms",
		median: percentile(values, 0.5),
		p90: percentile(values, 0.9),
		min: Math.min(...values),
		max: Math.max(...values),
		samples: values.length,
		...(files != null ? { files } : {}),
	};
}

/** Prints a readable line per result, then the line the runner parses. */
function report(results: readonly BenchResult[]) {
	for (const result of results) {
		const perFile =
			result.files != null && result.files > 0
				? ` (${((result.median / result.files) * 1000).toFixed(0)} µs/file)`
				: "";
		console.log(
			`${result.label}: median ${result.median.toFixed(1)} ms${perFile}, ` +
				`p90 ${result.p90.toFixed(1)} ms, ${result.samples} samples`,
		);
	}
	console.log(`${RESULT_PREFIX}${JSON.stringify(results)}`);
}

export const benchWorkspace = { generate, touchModel };
export const benchStats = { percentile, summarize, report };
