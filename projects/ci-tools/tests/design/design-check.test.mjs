import { vol } from "memfs";
import { afterEach, describe, expect, it } from "vitest";
import { BASELINE, runDesignCheck } from "../../src/design/design-check.command.mjs";

const root = "/workspace";

/** A workspace with one package, `http`, holding these files under projects/http. */
function seed(files, baseline) {
	vol.fromJSON({
		[`${root}/projects/http/package.json`]: JSON.stringify({ name: "@decohere/http" }),
		...Object.fromEntries(
			Object.entries(files).map(([path, text]) => [`${root}/projects/http/${path}`, text]),
		),
		...(baseline ? { [`${root}/${BASELINE}`]: JSON.stringify(baseline) } : {}),
	});
}

function run(argv = []) {
	const lines = [];
	const code = runDesignCheck({ argv, root, log: (line) => lines.push(line) });
	return { code, output: lines.join("\n") };
}

const CLEAN = {
	"src/index.ts": 'export * from "./routing/router.service.js";\n',
	"src/routing/router.service.ts": "export class RouterService {}\n",
	"src/routing/router.service.spec.ts": "it('routes', () => {});\n",
};

afterEach(() => vol.reset());

describe("design:check", () => {
	it("passes code that keeps ADR 0027, with no baseline", () => {
		seed(CLEAN);
		expect(run()).toEqual({ code: 0, output: expect.stringContaining("design: 0 breaks") });
	});

	it("fails a new loose function, naming where it is", () => {
		seed(
			{
				...CLEAN,
				"src/routing/route-path.value.ts": "export function toPath(p: string) { return p; }\n",
			},
			{ http: {} },
		);
		const { code, output } = run();
		expect(code).toBe(1);
		expect(output).toContain("http  exported loose functions");
		expect(output).toContain("0 → 1  (+1), among:");
		expect(output).toContain("projects/http/src/routing/route-path.value.ts: toPath");
	});

	it("counts each rule ADR 0027 sets", () => {
		seed({
			"src/index.ts": "",
			"src/path.util.ts": "export const x = 1;\n",
			"src/query.types.ts": "export type Q = {};\n",
			"src/router.ts": "export class A {}\nexport class B {}\nconst e = process.env.X;\n",
			"src/aliases.service.ts": "function a() {}\nexport const aliases = { a };\n",
			"tests/router.spec.ts": "it('x', () => {});\n",
		});
		run(["--update"]);
		const written = String(vol.readFileSync(`${root}/${BASELINE}`));
		// As Prettier formats JSON in this repo, so an update changes only the counts.
		expect(written).toMatch(/^\{\n {2}"http": \{\n {4}"/);
		expect(JSON.parse(written)).toEqual({
			http: {
				bannedNames: 2,
				noRole: 3,
				severalClasses: 1,
				envReads: 1,
				namespaceObjects: 1,
				specsAway: 1,
			},
		});
	});

	it("counts environment reads in code, not the words in a string or a comment", () => {
		seed({
			"src/app.service.ts":
				"// reads process.env.PORT\nexport class AppService {\n" +
				'\tpublic readonly text = "const port = process.env.PORT;";\n' +
				"\tpublic readonly port = process.env.PORT;\n}\n",
		});
		expect(run(["--update"]).code).toBe(0);
		expect(JSON.parse(vol.readFileSync(`${root}/${BASELINE}`, "utf8"))).toEqual({
			http: { envReads: 1 },
		});
	});

	it("keeps the factory in a .plugin.ts file, whatever it returns", () => {
		seed({
			"src/pino.plugin.ts":
				"export function pino(): PinoAdapter {\n\treturn new PinoAdapter();\n}\n",
		});
		expect(run()).toEqual({ code: 0, output: expect.stringContaining("design: 0 breaks") });
	});

	it("keeps plugin factories, decorators, define helpers and predicates", () => {
		seed({
			...CLEAN,
			"src/http.plugin.ts": [
				"export function http(): BuilderPlugin { return (builder) => {}; }",
				"export function injectRouter(): ParameterDecorator { return (target) => {}; }",
				"export function defineRoute(r: unknown) { return r; }",
				"export const isRoute = (r: unknown) => r != null;",
			].join("\n"),
		});
		expect(run().code).toBe(0);
	});

	it("asks for the baseline to be lowered when a count falls, so it can't rise again", () => {
		seed(CLEAN, { http: { looseFunctions: 3 } });
		const { code, output } = run();
		expect(code).toBe(1);
		expect(output).toContain("http  exported loose functions");
		expect(output).toContain("pnpm design:check --update");

		run(["--update"]);
		expect(run().code).toBe(0);
	});
});
