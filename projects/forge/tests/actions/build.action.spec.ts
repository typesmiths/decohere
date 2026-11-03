import type { Workspace } from "@decohere/workspace";
import { Project } from "@decohere/workspace";
import { FileEx } from "@decohere/core/io";
import { resetMemfs } from "@decohere/testing";
import { afterEach, beforeEach, expect, it, type MockInstance, vi } from "vitest";
import { Build } from "../../src/actions/build.action.js";
import { ForgeError } from "../../src/errors.js";
import type { FileWriterService } from "../../src/services/file-writer.service.js";
import { SwcTranspiler } from "../../src/services/swc-transpiler.js";
import { TypeEmitter } from "../../src/services/type-emitter.js";
import type { ForgeConfiguration } from "../../src/types/configuration.type.js";
import { TransformResponse } from "../../src/types/transform-response.model.js";
import type { Transformer } from "../../src/types/transformer.type.js";
import { WorkspaceDefaults } from "../../src/workspace.config.js";

const project = new Project("MOCK", WorkspaceDefaults, "release");
const transpiler = new SwcTranspiler();
const typeEmitter = new TypeEmitter();
let transpileProject: MockInstance;
let typeEmitProject: MockInstance;
let fileWriter: Pick<FileWriterService, "warmup" | "enqueueOutput" | "flush">;

function createBuild(transformers: Transformer[]) {
	return new Build(
		null as unknown as Workspace,
		transformers,
		fileWriter as FileWriterService,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	transpileProject = vi.spyOn(transpiler, "transformProject").mockResolvedValue([]);
	typeEmitProject = vi.spyOn(typeEmitter, "transformProject").mockResolvedValue([]);
	fileWriter = {
		warmup: vi.fn().mockResolvedValue(undefined),
		enqueueOutput: vi.fn(),
		flush: vi.fn().mockResolvedValue(undefined),
	};
});

afterEach(() => {
	resetMemfs();
});

it("should throw if no transformers are configured", () => {
	expect(() => createBuild([])).toThrow(ForgeError);
	expect(() => createBuild(null as unknown as Transformer[])).toThrow(ForgeError);
});

it("can be called with project or array of projects", () => {
	const project1 = new Project("MOCK_PROJECT_1", WorkspaceDefaults, "release");
	const project2 = new Project("MOCK_PROJECT_2", WorkspaceDefaults, "release");
	const build = createBuild([transpiler]);

	const buildProject = () => build.build(project1);
	expect(buildProject).not.toThrow();
	const buildProjects = () => build.build([project1, project2]);
	expect(buildProjects).not.toThrow();
});

it("should call transform once per transformer with all projects", async () => {
	const project1 = new Project("MOCK_PROJECT_1", WorkspaceDefaults, "release");
	const project2 = new Project("MOCK_PROJECT_2", WorkspaceDefaults, "release");
	const build = createBuild([transpiler, typeEmitter]);
	await build.build([project1, project2]);
	expect(transpileProject).toHaveBeenCalledTimes(1);
	expect(typeEmitProject).toHaveBeenCalledTimes(1);

	expect(transpileProject).toHaveBeenCalledWith(
		[project1, project2],
		undefined,
		expect.any(Function),
	);
	expect(typeEmitProject).toHaveBeenCalledWith(
		[project1, project2],
		undefined,
		expect.any(Function),
	);
	expect(fileWriter.flush).toHaveBeenCalledTimes(1);
});

it("should return responses from transpiler", async () => {
	const mockResponse = new TransformResponse();
	vi.spyOn(transpiler, "transformProject").mockResolvedValue([mockResponse]);
	const build = createBuild([transpiler, typeEmitter]);
	const responses = await build.build(project);
	expect(responses).toContain(mockResponse);
});

it("should use the project-selected configuration for transformers", async () => {
	const mockConfig = {
		name: "MOCK_CONFIG",
		targets: ["es6"],
	} as ForgeConfiguration;
	const configuredProject = new Project(
		"MOCK_CONFIGURED",
		{ ...WorkspaceDefaults, configurations: [mockConfig] },
		mockConfig.name,
	);

	const build = createBuild([transpiler, typeEmitter]);
	await build.build(configuredProject);

	expect(transpileProject).toHaveBeenCalledWith(
		[configuredProject],
		undefined,
		expect.any(Function),
	);
	expect(typeEmitProject).toHaveBeenCalledWith(
		[configuredProject],
		undefined,
		expect.any(Function),
	);
});

it("should enqueue outputs and flush writes", async () => {
	const file = new FileEx({ fullPath: "/path/to/file" });
	const mockResponse = new TransformResponse({
		outcome: "success",
		file,
		project,
		outputPath: "MOCK_DIR",
	});
	vi.spyOn(transpiler, "transformProject").mockImplementation(
		async (_projects, _filter, onOutput) => {
			onOutput?.(mockResponse);
			return [mockResponse];
		},
	);
	const build = createBuild([transpiler, typeEmitter]);
	await build.build(project);
	expect(fileWriter.enqueueOutput).toHaveBeenCalledWith(mockResponse);
	expect(fileWriter.flush).toHaveBeenCalledTimes(1);
});
