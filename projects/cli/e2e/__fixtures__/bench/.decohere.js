// Benchmark config for apples-to-apples comparison with v1 "local" build:
// es6 + types only (no commonjs), matching DefaultConfiguration.local in v1.
export default {
	configurations: [
		{
			name: "local",
			targets: ["es6", "types"],
			ignore: ["**/*.spec.ts", "**/*.test.ts"],
		},
		{
			name: "debug",
			targets: ["es6"],
		},
		{
			name: "types-only",
			targets: ["types"],
			ignore: ["**/*.spec.ts", "**/*.test.ts"],
		},
	],
};
