import { PackageJson } from "@decohere/workspace";
import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { afterEach, describe, expect, it } from "vitest";
import { ForgeError } from "../../src/errors.js";
import { ImportGraph, type ReleaseProject } from "../../src/packaging/import-graph.service.js";

afterEach(() => {
	resetMemfs();
});

function project(
	name: string,
	dir: string,
	manifest: Record<string, unknown>,
): ReleaseProject {
	return {
		name,
		pkg: new PackageJson({ name, version: "1.0.0", ...manifest }),
		projectRoot: `/ws/projects/${dir}`,
		releaseDir: `/ws/dist/release/projects/${dir}`,
	};
}

const api = project("@app/api", "api", { main: "src/main.ts" });
const kernel = project("@app/kernel", "kernel", {
	main: "src/index.ts",
	exports: { ".": "./src/index.ts", "./testing": "./src/testing/index.ts" },
});

function projectsOf(...all: ReleaseProject[]) {
	return new Map(all.map((p) => [p.name, p]));
}

function release(files: Record<string, string>) {
	vol.fromJSON(
		Object.fromEntries(
			Object.entries(files).map(([file, code]) => [`/ws/dist/release/projects/${file}`, code]),
		),
	);
}

describe("ImportGraph", () => {
	it("follows relative imports and collects the workspace and third-party packages reached", async () => {
		release({
			"api/es6/src/main.js": `import { run } from "./app.js";\nimport "@app/kernel";\nrun();`,
			"api/es6/src/app.js": `import { readFile } from "node:fs/promises";\nimport pino from "pino";\nexport const run = () => {};`,
			"kernel/es6/src/index.js": `import ms from "ms";\nexport default ms;`,
		});

		const reached = await new ImportGraph().walk(api, projectsOf(api, kernel));

		expect([...reached.workspace].sort()).toEqual(["@app/api", "@app/kernel"]);
		expect([...reached.thirdParty.keys()].sort()).toEqual(["ms", "pino"]);
		expect([...(reached.thirdParty.get("ms") ?? [])]).toEqual(["@app/kernel"]);
		expect([...(reached.thirdParty.get("pino") ?? [])]).toEqual(["@app/api"]);
	});

	it("follows a subpath export such as @app/kernel/testing", async () => {
		release({
			"api/es6/src/main.js": `import { assertOk } from "@app/kernel/testing";`,
			"kernel/es6/src/testing/index.js": `import { expect } from "vitest";\nexport const assertOk = expect;`,
		});

		const reached = await new ImportGraph().walk(api, projectsOf(api, kernel));

		expect(reached.workspace.has("@app/kernel")).toBe(true);
		expect([...reached.thirdParty.keys()]).toEqual(["vitest"]);
	});

	it("does not open code nothing imports, so its dependencies stay out", async () => {
		release({
			"api/es6/src/main.js": `import { value } from "@app/kernel";`,
			"kernel/es6/src/index.js": `export const value = 1;`,
			"kernel/es6/src/testing/index.js": `import { expect } from "vitest";`,
		});

		const reached = await new ImportGraph().walk(api, projectsOf(api, kernel));

		expect([...reached.thirdParty.keys()]).toEqual([]);
	});

	it("follows re-exports and dynamic imports with a literal specifier", async () => {
		release({
			"api/es6/src/main.js": `export * from "./a.js";\nawait import("./b.js");`,
			"api/es6/src/a.js": `export { x } from "left-pad";`,
			"api/es6/src/b.js": `export const y = 1;`,
		});

		const reached = await new ImportGraph().walk(api, projectsOf(api));

		expect([...reached.thirdParty.keys()]).toEqual(["left-pad"]);
	});

	it("reads a package's own subpath of a third-party import as the package", async () => {
		release({
			"api/es6/src/main.js": `import x from "@scope/lib/deep/file.js";\nimport "lodash/fp";`,
		});

		const reached = await new ImportGraph().walk(api, projectsOf(api));

		expect([...reached.thirdParty.keys()].sort()).toEqual(["@scope/lib", "lodash"]);
	});

	it("fails clearly when a workspace package does not export the subpath", async () => {
		release({
			"api/es6/src/main.js": `import "@app/kernel/missing";`,
			"kernel/es6/src/index.js": ``,
		});

		await expect(new ImportGraph().walk(api, projectsOf(api, kernel))).rejects.toThrow(
			'@app/api imports "@app/kernel/missing", but @app/kernel does not export "./missing"',
		);
	});

	it("fails clearly when the release build is missing a reached file", async () => {
		release({ "api/es6/src/main.js": `import "./gone.js";` });

		const walk = new ImportGraph().walk(api, projectsOf(api));

		await expect(walk).rejects.toBeInstanceOf(ForgeError);
		await expect(walk).rejects.toThrow("forge build --configuration release");
	});

	it("resolves a library that has only a main, through its es6 output", async () => {
		const plain = project("@app/plain", "plain", { main: "src/index.ts" });
		release({
			"api/es6/src/main.js": `import "@app/plain";`,
			"plain/es6/src/index.js": `import "ms";`,
		});

		const reached = await new ImportGraph().walk(api, projectsOf(api, plain));

		expect([...reached.thirdParty.keys()]).toEqual(["ms"]);
	});
});
