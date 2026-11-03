import { describe, expect, it } from "vitest";
import { staticImports } from "../src/static-imports.js";

describe("staticImports.scan", () => {
	it("finds the specifiers SWC's output imports and re-exports", () => {
		const code = [
			`import { a, b as c } from "./a.js";`,
			`import * as ns from "@scope/pkg";`,
			`import def, { d } from '../d';`,
			`import "./side-effect";`,
			`export * from "./models";`,
			`export { e } from "./e.js";`,
			`const lazy = () => import("./lazy.js");`,
			`import {`,
			`\tmany,`,
			`\tnames,`,
			`} from "./wrapped.js";`,
		].join("\n");

		expect(staticImports.scan(code)).toEqual([
			"./a.js",
			"@scope/pkg",
			"../d",
			"./side-effect",
			"./models",
			"./e.js",
			"./wrapped.js",
			"./lazy.js",
		]);
	});

	it("ignores computed dynamic imports, which only Node can resolve", () => {
		expect(staticImports.scan("const m = await import(`./${name}.js`);")).toEqual([]);
	});

	it("lists each specifier once", () => {
		expect(staticImports.scan(`import "./x";\nimport { y } from "./x";\n`)).toEqual(["./x"]);
	});

	it("does not read the inline source map as imports", () => {
		const code = `export const x = 1;\n//# sourceMappingURL=data:application/json;base64,eyJpbXBvcnQiOiAiLi94In0=\n`;
		expect(staticImports.scan(code)).toEqual([]);
	});
});
