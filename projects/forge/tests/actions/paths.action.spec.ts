import { readFileSync, writeFileSync } from "node:fs";
import { PackageJson, Workspace } from "@decohere/workspace";
import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PATHS_FILE, Paths } from "../../src/actions/paths.action.js";
import { WorkspaceDefaults } from "../../src/workspace.config.js";

function workspace() {
	vol.fromJSON({
		"/ws/projects/lib/src/index.ts": "",
		"/ws/projects/lib/src/io/index.ts": "",
	});
	return new Workspace({
		config: { ...WorkspaceDefaults, rootDir: "/ws" },
		projects: [
			{
				name: "@t/lib",
				config: {
					...WorkspaceDefaults,
					rootDir: "/ws",
					projectDir: "projects/lib",
					packageJson: new PackageJson({ name: "@t/lib", main: "src/index.ts" }),
				},
			},
		],
	});
}

describe("forge paths", () => {
	beforeEach(() => resetMemfs());
	afterEach(() => resetMemfs());

	it("writes tsconfig paths for each package and its subpaths", async () => {
		const response = await new Paths(workspace()).run({});

		expect(response.succeeded).toBe(true);
		const written = JSON.parse(readFileSync(`/ws/${PATHS_FILE}`, "utf8"));
		expect(written.compilerOptions.paths).toEqual({
			"@t/lib": ["./projects/lib/src/index.ts"],
			"@t/lib/*": ["./projects/lib/src/*"],
		});
	});

	it("--check passes when the file is up to date", async () => {
		const ws = workspace();
		await new Paths(ws).run({});

		const response = await new Paths(ws).run({ check: true });

		expect(response.succeeded).toBe(true);
	});

	it("--check fails without writing when the file is missing or out of date", async () => {
		const ws = workspace();
		expect((await new Paths(ws).run({ check: true })).succeeded).toBe(false);

		await new Paths(ws).run({});
		writeFileSync(`/ws/${PATHS_FILE}`, "{}\n");
		const response = await new Paths(ws).run({ check: true });

		expect(response.succeeded).toBe(false);
		expect(response.message).toContain("out of date");
		expect(readFileSync(`/ws/${PATHS_FILE}`, "utf8")).toBe("{}\n");
	});
});
