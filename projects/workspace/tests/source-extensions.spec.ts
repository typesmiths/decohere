import { sourceExtensions } from "@decohere/workspace";
import { describe, expect, it } from "vitest";

describe("sourceExtensions", () => {
	it("maps an import's extension to the sources it can name", () => {
		expect(sourceExtensions.candidates("/a/b.js")).toEqual(["/a/b.ts", "/a/b.tsx"]);
		expect(sourceExtensions.candidates("/a/b.mjs")).toEqual(["/a/b.mts"]);
		expect(sourceExtensions.candidates("/a/b.cjs")).toEqual(["/a/b.cts"]);
		expect(sourceExtensions.candidates("/a/b.jsx")).toEqual(["/a/b.tsx"]);
		expect(sourceExtensions.candidates("/a/b")).toEqual(["/a/b.ts", "/a/b.tsx"]);
		expect(sourceExtensions.candidates("/a/b.mts")).toEqual(["/a/b.mts"]);
	});

	it("treats declaration files as not sources", () => {
		expect(sourceExtensions.isSource("/a/b.ts")).toBe(true);
		expect(sourceExtensions.isSource("/a/b.tsx")).toBe(true);
		expect(sourceExtensions.isSource("/a/b.d.ts")).toBe(false);
		expect(sourceExtensions.isSource("/a/b.d.mts")).toBe(false);
	});

	it("names build output and module kind by source extension", () => {
		expect(sourceExtensions.outputExtension("/a/b.mts")).toBe(".mjs");
		expect(sourceExtensions.outputExtension("/a/b.cts")).toBe(".cjs");
		expect(sourceExtensions.outputExtension("/a/b.tsx")).toBe(".js");
		expect(sourceExtensions.outputPath("src/a.mts")).toBe("src/a.mjs");
		expect(sourceExtensions.outputPath("src/a.cts")).toBe("src/a.cjs");
		expect(sourceExtensions.outputPath("src/a.tsx")).toBe("src/a.js");
		expect(sourceExtensions.outputPath("src/a.ts")).toBe("src/a.js");
		expect(sourceExtensions.outputPath("bin/cli")).toBe("bin/cli.js");
		expect(sourceExtensions.isCommonJs("/a/b.cts")).toBe(true);
		expect(sourceExtensions.isCommonJs("/a/b.mts")).toBe(false);
	});
});
