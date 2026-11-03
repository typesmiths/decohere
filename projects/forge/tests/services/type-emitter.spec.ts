import { Project } from "@decohere/workspace";
import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import * as ts from "typescript";
import { afterEach, expect, it, vi } from "vitest";
import { TypeEmitter } from "../../src/services/type-emitter.js";
import { Debug, Release, WorkspaceDefaults } from "../../src/workspace.config.js";

vi.mock("typescript", { spy: true });

//TODO should test that the project files are passed to createProgram
afterEach(() => {
	resetMemfs();
});

it("reads tsconfig for each project when emitting", async () => {
	const compilerOptions = { declaration: true, emitDeclarationOnly: true };
	vol.fromJSON({
		"MOCK1/tsconfig.json": JSON.stringify({
			compilerOptions,
		}),
		"MOCK2/tsconfig.json": JSON.stringify({
			compilerOptions,
		}),
	});

	const projects = [
		new Project("MOCK1", { ...WorkspaceDefaults, configurations: [Release] }, "release"),
		new Project("MOCK2", { ...WorkspaceDefaults, configurations: [Release] }, "release"),
	];
	const readConfigFile1 = vi.spyOn(projects[0], "getTsConfig");
	const readConfigFile2 = vi.spyOn(projects[1], "getTsConfig");
	const createProgram = vi.spyOn(ts, "createProgram");
	const typeEmitter = new TypeEmitter();
	await typeEmitter.transformProject(projects);
	expect(readConfigFile1).toHaveBeenCalledTimes(1);
	expect(readConfigFile2).toHaveBeenCalledTimes(1);
	expect(createProgram).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining(compilerOptions),
		expect.anything(),
		undefined,
	);
});

it("enforces emitDeclarationOnly:true even when tsconfig sets it to false", async () => {
	vol.fromJSON({
		"MOCK/tsconfig.json": JSON.stringify({
			compilerOptions: { declaration: true, emitDeclarationOnly: false },
		}),
	});
	const createProgram = vi.spyOn(ts, "createProgram");
	const projects = new Project(
		"MOCK",
		{ ...WorkspaceDefaults, configurations: [Release] },
		"release",
	);
	const typeEmitter = new TypeEmitter();
	await typeEmitter.transformProject(projects);
	expect(createProgram).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({ emitDeclarationOnly: true }),
		expect.anything(),
		undefined,
	);
});

it("enforces declaration:true even when tsconfig sets it to false", async () => {
	vol.fromJSON({
		"MOCK/tsconfig.json": JSON.stringify({
			compilerOptions: { declaration: false },
		}),
	});
	const createProgram = vi.spyOn(ts, "createProgram");
	const projects = new Project(
		"MOCK",
		{ ...WorkspaceDefaults, configurations: [Release] },
		"release",
	);
	const typeEmitter = new TypeEmitter();
	await typeEmitter.transformProject(projects);
	expect(createProgram).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({ declaration: true }),
		expect.anything(),
		undefined,
	);
});

it("type-check creates a noEmit program for projects without a types target", async () => {
	vol.fromJSON({
		"MOCK/tsconfig.json": JSON.stringify({
			compilerOptions: { noLib: true, lib: [], types: [] },
		}),
		"MOCK/src/index.ts": "export const value = 1;",
	});
	const createProgram = vi.spyOn(ts, "createProgram");
	const project = new Project(
		"MOCK",
		{ ...WorkspaceDefaults, configurations: [Debug] },
		"debug",
	);
	const typeEmitter = new TypeEmitter();
	await typeEmitter.checkProject(project);
	expect(createProgram).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({ noEmit: true }),
		expect.anything(),
		undefined,
	);
});
