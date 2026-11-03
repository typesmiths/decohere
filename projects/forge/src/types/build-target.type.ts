export const BuildTargets = {
	commonjs: "commonjs",
	es6: "es6",
	types: "types",
} satisfies Record<BuildTarget, BuildTarget>;

export type BuildTarget = "es6" | "commonjs" | "types";

export type TranspileTarget = Exclude<BuildTarget, "types">;
