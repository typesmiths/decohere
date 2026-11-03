import { PackageJson } from "@decohere/workspace";
import { describe, expect, it } from "vitest";
import { releaseExports } from "../../src/packaging/release-exports.js";

const pkg = (manifest: Record<string, unknown>) => new PackageJson({ name: "x", ...manifest });

describe("releaseExports.build", () => {
	it("points a plain subpath map at es6 output", () => {
		expect(
			releaseExports.build(
				pkg({ exports: { ".": "./src/index.ts", "./testing": "./src/testing/index.ts" } }),
			),
		).toEqual({ ".": "./es6/src/index.js", "./testing": "./es6/src/testing/index.js" });
	});

	it("falls back to main, and to src/index.ts when there is no main", () => {
		expect(releaseExports.build(pkg({ main: "src/main.ts" }))).toEqual({
			".": "./es6/src/main.js",
		});
		expect(releaseExports.build(pkg({}))).toEqual({ ".": "./es6/src/index.js" });
	});

	it("picks the import condition and ignores types, and keeps paths already in es6", () => {
		expect(
			releaseExports.build(
				pkg({
					exports: {
						".": {
							types: "./types/src/index.d.ts",
							import: "./es6/src/index.js",
							require: "./commonjs/src/index.js",
						},
						"./vitest": { import: "./src/vitest/index.ts", default: "./nope.js" },
					},
				}),
			),
		).toEqual({ ".": "./es6/src/index.js", "./vitest": "./es6/src/vitest/index.js" });
	});

	it("treats a bare string and a conditions object as the root export", () => {
		expect(releaseExports.build(pkg({ exports: "./src/a.ts" }))).toEqual({
			".": "./es6/src/a.js",
		});
		expect(releaseExports.build(pkg({ exports: { import: "./src/b.ts" } }))).toEqual({
			".": "./es6/src/b.js",
		});
	});
});

describe("releaseExports.resolve", () => {
	const exports = {
		".": "./es6/src/index.js",
		"./testing": "./es6/src/testing/index.js",
		"./features/*": "./es6/src/features/*.js",
	};

	it("finds the root, a named subpath and a wildcard subpath", () => {
		expect(releaseExports.resolve(exports, "")).toBe("./es6/src/index.js");
		expect(releaseExports.resolve(exports, "/testing")).toBe("./es6/src/testing/index.js");
		expect(releaseExports.resolve(exports, "/features/auth")).toBe(
			"./es6/src/features/auth.js",
		);
	});

	it("returns undefined for a subpath that is not exported", () => {
		expect(releaseExports.resolve(exports, "/internal")).toBeUndefined();
	});
});
