// Vitest setup for every test run (vitest.config.ts): files live in memory (memfs), and
// import() can load them from there.
import { registerHooks } from "node:module";
import { vol } from "memfs";
import { vi } from "vitest";

// Module load hook: intercept ES module imports and serve content from memfs if present.
//
// This hook enables testing of dynamic imports and configuration file loading without disk I/O.
// It works by intercepting the load hook for module URLs and checking memfs's virtual volume.
// If a path exists in memfs, the file content is returned directly; otherwise, the default
// loader handles the import.
//
// Used by:
// - HotReloadServer unit edges (projects/flux/tests/hmr.server.spec.ts)
//   Tests dispose / resolveProject / multi-branch graph edges using in-memory files
// - Forge config loading tests (projects/forge/tests/integration/commands/build.integration.spec.ts)
//   Tests dynamic import of .decohere.js configuration files from memfs
//
// For details and patterns, see: docs/testing/how-tos/module-load-hooks-with-memfs.md
registerHooks({
	load: (url, context, next) => {
		try {
			const path = new URL(url).pathname;
			console.log(path);
			if (vol.existsSync(path)) {
				const source = vol.readFileSync(path, "utf-8") as string;
				return { format: "module", source, shortCircuit: true };
			}
		} catch {
			// not a file URL, pass through
		}
		return next(url, context);
	},
});

// node:fs and glob read and write memfs. realFs is the real disk, for the tests that need it.
export const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");

vi.mock("fs");
vi.mock("fs/promises");
vi.mock("node:fs");
vi.mock("node:fs/promises");
vi.mock("glob", async () => {
	const actual = await vi.importActual<typeof import("glob")>("glob");
	const { withMemfsFsForGlob } = await import("@decohere/testing");
	return withMemfsFsForGlob(actual);
});
