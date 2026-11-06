import { defineConfig } from "vitest/config";
import "./tools/register.mjs";

// Load the plugin from source (registered above) rather than a published build.
const { forgeBuild } = await import("@decohere/forge/vitest");

export default defineConfig({
	plugins: [forgeBuild({ logLevel: "silent" })],
	test: {
		// Spies keep their call history otherwise: restoreAllMocks() doesn't clear it.
		clearMocks: true,
		// Run one with `--project <name>`. `pnpm test` runs "unit"; the scripts in package.json run the others.
		server: {
			deps: {
				// Run through vitest so its fs reads reach the memfs mock.
				inline: ["get-tsconfig"],
				external: [
					"glob",
					/projects\/flux\/tests\/__fixtures__\/hmr/,
					/projects\/forge\/tests\/__fixtures__\/\.decohere(\.(projects))?\.js/,
					/projects\/cli\/tests\/__fixtures__\/\.decohere(\.(projects))?\.js/,
					/projects\/cli\/tests\/__fixtures__\//,
				],
			},
		},
		projects: [
			{
				extends: true,
				test: {
					name: "unit",
					include: ["projects/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
					// *.docker.spec.ts need a Docker daemon: the "docker" project (`pnpm test:docker`).
					exclude: ["**/node_modules/**", "**/e2e/**", "**/*.docker.spec.ts"],
					setupFiles: ["vitest.setup.ts"],
				},
			},
			{
				// Real Postgres and the like: `pnpm test:docker`.
				extends: true,
				test: {
					name: "docker",
					include: ["projects/**/*.docker.spec.ts"],
					exclude: ["**/node_modules/**"],
					setupFiles: ["vitest.setup.ts"],
					testTimeout: 120_000,
					hookTimeout: 120_000,
				},
			},
			{
				// Built CLIs and the scaffolder: `pnpm test:e2e`.
				extends: true,
				test: {
					name: "e2e",
					include: [
						"e2e/**/*.{test,spec}.?(c|m)[t]s?(x)",
						"projects/**/e2e/**/*.{test,spec}.?(c|m)[t]s?(x)",
					],
					exclude: ["**/node_modules/**", "dist/**"],
					testTimeout: 120_000,
				},
			},
		],
		coverage: {
			provider: "v8",
			reporter: process.env.CI
				? ["lcov", "json-summary"]
				: ["text", "html", "lcov", "json-summary"],
			reportsDirectory: "dist/coverage",
			include: ["projects/**/src/**/*.{ts,tsx,mts,cts,mjs}"],
			exclude: [
				"**/*.{test,spec}.?(c|m)[jt]s?(x)",
				"**/*.d.ts",
				"**/*.type.ts",
				"**/*.type.mts",
				// CI audit reporters/upserts — ops tooling, not product surface.
				"projects/ci-tools/src/audit/**",
			],
			thresholds: {
				lines: 50,
				// About 5 points below today's 70%, so ops/script noise does not flake main. Vitest 4 counts
				// branches differently: the same code and tests measured 85.5% on Vitest 3.
				branches: 65,
				functions: 76,
				statements: 50,
			},
		},
	},
});
