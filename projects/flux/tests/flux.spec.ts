/**
 * Unit: `flux.run` compiles and imports a `.ts` entry without the caller
 * assembling SourceModuleLoader hooks. CLI `flux run` lives in
 * `projects/cli/tests/flux.integration.spec.ts`.
 */

import { DefaultConfigurations, WorkspaceDefaults } from "@decohere/forge";
import { PackageJson, Workspace } from "@decohere/workspace";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("fs");
vi.mock("node:fs");

import { flux } from "../src/flux.js";

const fixturesDir = new URL("./__fixtures__/hmr-ts", import.meta.url).pathname;
const mainPath = `${fixturesDir}/main.ts`;
const depAPath = `${fixturesDir}/dep-a.ts`;
const depBPath = `${fixturesDir}/dep-b.ts`;
const runEntryPath = `${fixturesDir}/run-entry.ts`;

function makeWorkspace() {
	return new Workspace({
		config: {
			...WorkspaceDefaults,
			rootDir: fixturesDir,
		},
		projects: [
			{
				name: "hmr-ts",
				config: {
					...WorkspaceDefaults,
					rootDir: fixturesDir,
					projectDir: ".",
					configurations: DefaultConfigurations,
					packageJson: new PackageJson({ main: "main.ts" }),
				},
			},
		],
	});
}

async function seedFromDisk() {
	const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
	vol.fromJSON({
		[mainPath]: realFs.readFileSync(mainPath, "utf8") as string,
		[depAPath]: realFs.readFileSync(depAPath, "utf8") as string,
		[depBPath]: realFs.readFileSync(depBPath, "utf8") as string,
		[runEntryPath]: realFs.readFileSync(runEntryPath, "utf8") as string,
	});
}

describe("flux.run", () => {
	beforeEach(async () => {
		await seedFromDisk();
	});

	afterEach(() => {
		flux.dispose();
		vol.reset();
	});

	it("imports a TypeScript entry, compiles deps, and honors bin-style argv", async () => {
		await flux.run(runEntryPath, {
			workspace: makeWorkspace(),
			args: ["alpha", "beta"],
		});
		expect(JSON.parse(vol.readFileSync("/run-booted.json", "utf8") as string)).toEqual({
			value: 1,
			argv: ["alpha", "beta"],
		});
	});

	it("rejects a missing entry path", async () => {
		await expect(flux.run("  ")).rejects.toThrow("flux.run requires an entry file path");
	});
});
