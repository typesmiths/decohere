import { afterEach, describe, expect, it } from "vitest";
import { SourceModuleLoader } from "../src/source-module-loader.js";

// Flux compiles TypeScript with inline source maps, but Node only uses them when source
// maps are enabled. Without that, stack traces pointed at the compiled code's line numbers
// (an error on line 8 of a decorated class was reported on line 9).
describe("SourceModuleLoader", () => {
	const wasEnabled = process.sourceMapsEnabled;
	let loader: SourceModuleLoader | undefined;

	afterEach(async () => {
		await loader?.[Symbol.asyncDispose]?.();
		process.setSourceMapsEnabled(wasEnabled);
	});

	it("turns on source maps so stack traces point at the TypeScript lines", () => {
		process.setSourceMapsEnabled(false);
		loader = new SourceModuleLoader();

		loader.registerHooks();

		expect(process.sourceMapsEnabled).toBe(true);
	});
});
