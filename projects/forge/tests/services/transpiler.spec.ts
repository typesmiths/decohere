import type { ProjectFileEvent } from "@decohere/workspace";
import { PackageJson, Project, Workspace } from "@decohere/workspace";
import { Caching } from "@decohere/core/caching";
import { FileEx } from "@decohere/core/io";
import { WatchEvents } from "@decohere/devkit/io";
import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SwcConfigFactory } from "../../src/factories/swc-config.factory.js";
import { SwcTranspiler } from "../../src/services/swc-transpiler.js";
import { WorkspaceDefaults } from "../../src/workspace.config.js";

const projectDir = "projects/mylib";
const rootDir = "./";
const sourceFile = `${projectDir}/src/index.ts`;
const swcConfigContent = JSON.stringify({ jsc: { target: "es2019" } });

beforeEach(() => {
	vi.spyOn(process, "cwd").mockReturnValue("/");
});

afterEach(() => {
	resetMemfs();
	Caching.flushAllCaches();
	vi.restoreAllMocks();
});

it("should transpile a project", async () => {
	vol.fromJSON({ [sourceFile]: "export const value = 1;" });

	const transpiler = new SwcTranspiler();
	const project = new Project(projectDir, { ...WorkspaceDefaults, rootDir });
	const [response] = await transpiler.transformProject(project);
	expect(response.outcome).toBe("success");
	expect(response.code).toMatch(/export const value = 1;/);
});

it("should use .swcrc from project directory when present", async () => {
	vol.fromJSON({
		[sourceFile]: "export const value = 1;",
		[`${projectDir}/.swcrc`]: swcConfigContent,
	});

	const createBaseConfig = vi.spyOn(SwcConfigFactory.prototype, "createBaseConfig");
	const transpiler = new SwcTranspiler();
	const project = new Project(projectDir, { ...WorkspaceDefaults, rootDir });
	await transpiler.transformProject(project);

	expect(createBaseConfig).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({
			userConfig: expect.objectContaining({ jsc: { target: "es2019" } }),
		}),
	);
});

it("should fall back to .swcrc in workspace root when not in project directory", async () => {
	vol.fromJSON({
		[sourceFile]: "export const value = 1;",
		[`${rootDir}.swcrc`]: swcConfigContent,
	});

	const createBaseConfig = vi.spyOn(SwcConfigFactory.prototype, "createBaseConfig");
	const transpiler = new SwcTranspiler();
	const project = new Project(projectDir, { ...WorkspaceDefaults, rootDir });
	await transpiler.transformProject(project);

	expect(createBaseConfig).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({
			userConfig: expect.objectContaining({ jsc: { target: "es2019" } }),
		}),
	);
});

it("should prefer project .swcrc over workspace root .swcrc", async () => {
	vol.fromJSON({
		[sourceFile]: "export const value = 1;",
		[`${projectDir}/.swcrc`]: JSON.stringify({ jsc: { target: "es2015" } }),
		[`${rootDir}.swcrc`]: JSON.stringify({ jsc: { target: "es2019" } }),
	});

	const createBaseConfig = vi.spyOn(SwcConfigFactory.prototype, "createBaseConfig");
	const transpiler = new SwcTranspiler();
	const project = new Project(projectDir, { ...WorkspaceDefaults, rootDir });
	await transpiler.transformProject(project);

	expect(createBaseConfig).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({
			userConfig: expect.objectContaining({ jsc: { target: "es2015" } }),
		}),
	);
});

it("finds the project .swcrc under the workspace root when run from another directory", async () => {
	vi.spyOn(process, "cwd").mockReturnValue("/elsewhere");
	const workspaceRoot = "/ws";
	vol.fromJSON({
		[`${workspaceRoot}/${projectDir}/.swcrc`]: JSON.stringify({ jsc: { target: "es2015" } }),
		[`${workspaceRoot}/.swcrc`]: JSON.stringify({ jsc: { target: "es2019" } }),
		// What a lookup relative to the current directory would find instead.
		[`/elsewhere/${projectDir}/.swcrc`]: JSON.stringify({ jsc: { target: "es2017" } }),
	});
	const project = new Project(projectDir, { ...WorkspaceDefaults, rootDir: workspaceRoot });

	expect(await project.getSwcConfig()).toMatchObject({ jsc: { target: "es2015" } });
	expect(project.getSwcConfigSync()).toMatchObject({ jsc: { target: "es2015" } });
});

it("should use empty SwcConfig when no .swcrc exists anywhere", async () => {
	vol.fromJSON({ [sourceFile]: "export const value = 1;" });

	const createBaseConfig = vi.spyOn(SwcConfigFactory.prototype, "createBaseConfig");
	const transpiler = new SwcTranspiler();
	const project = new Project(projectDir, { ...WorkspaceDefaults, rootDir });
	await transpiler.transformProject(project);

	expect(createBaseConfig).toHaveBeenCalledWith(
		expect.anything(),
		expect.objectContaining({ userConfig: expect.objectContaining({}) }),
	);
});

it("resolves tsconfig path aliases to relative imports when aliasPaths is true", async () => {
	const depDir = "projects/dep";
	vol.fromJSON({
		[`${projectDir}/src/index.ts`]: 'export { value } from "@MOCK/dep";',
		[`${depDir}/src/index.ts`]: "export const value = 1;",
		[`${rootDir}tsconfig.json`]: JSON.stringify({
			compilerOptions: {
				baseUrl: ".",
				paths: { "@MOCK/dep": [`${depDir}/src/index.ts`] },
			},
		}),
	});

	// WorkspaceDefaults Debug config has aliasPaths: true
	const transpiler = new SwcTranspiler();
	const project = new Project(projectDir, { ...WorkspaceDefaults, rootDir });
	const [response] = await transpiler.transformProject(project);

	expect(response.outcome).toBe("success");
	expect(response.code).not.toContain("@MOCK/dep");
	expect(response.code).toContain("dep");
});

it("leaves path aliases unresolved when aliasPaths is false", async () => {
	const depDir = "projects/dep";
	vol.fromJSON({
		[`${projectDir}/src/index.ts`]: 'export { value } from "@MOCK/dep";',
		[`${depDir}/src/index.ts`]: "export const value = 1;",
		[`${rootDir}tsconfig.json`]: JSON.stringify({
			compilerOptions: {
				baseUrl: ".",
				paths: { "@MOCK/dep": [`${depDir}/src/index.ts`] },
			},
		}),
	});

	// Release config has no aliasPaths
	const transpiler = new SwcTranspiler();
	const project = new Project(projectDir, { ...WorkspaceDefaults, rootDir }, "release");
	const [response] = await transpiler.transformProject(project);

	expect(response.outcome).toBe("success");
	expect(response.code).toContain("@MOCK/dep");
});

it("rewrites workspace package names to relative imports without tsconfig paths", async () => {
	const appDir = "projects/app";
	const libDir = "projects/lib";
	vol.fromJSON({
		[`${appDir}/src/index.ts`]: 'export { foo } from "@hmr/lib";',
		[`${libDir}/src/index.ts`]: "export const foo = 1;",
	});

	const workspace = new Workspace({
		config: { ...WorkspaceDefaults, rootDir },
		projects: [
			{
				name: "hmr-app",
				config: {
					...WorkspaceDefaults,
					rootDir,
					projectDir: appDir,
					packageJson: new PackageJson({ name: "hmr-app", main: "src/index.ts" }),
				},
			},
			{
				name: "@hmr/lib",
				config: {
					...WorkspaceDefaults,
					rootDir,
					projectDir: libDir,
					packageJson: new PackageJson({ name: "@hmr/lib", main: "src/index.ts" }),
				},
			},
		],
	});

	const transpiler = new SwcTranspiler();
	const responses = await transpiler.transformProject([...workspace.getProjects("debug")]);
	const app = responses.find((response) => response.file.fullPath.includes(`${appDir}/src`));

	expect(app?.outcome).toBe("success");
	expect(app?.code).not.toContain("@hmr/lib");
	expect(app?.code).toContain("lib");
});

it("does not re-transpile when a file change event fires but content is unchanged", async () => {
	vol.fromJSON({ [sourceFile]: "export const value = 1;" });

	const transpiler = new SwcTranspiler();
	const project = new Project(projectDir, { ...WorkspaceDefaults, rootDir });

	// Initial build — populates the content cache
	await transpiler.transformProject(project);

	const transformSpy = vi.spyOn(transpiler, "transformProject");

	// Simulate a save-without-change: same content still on disk, watcher fires "change"
	const file = new FileEx({
		fullPath: `/${sourceFile}`,
		relativePath: "src/index.ts",
	});
	const evt: ProjectFileEvent = {
		eventName: WatchEvents.change,
		project,
		configuration: "debug",
		file,
	};

	await (transpiler as any).onIncrementalFileEvent(evt);

	expect(transformSpy).not.toHaveBeenCalled();
});

it("does not re-transpile after a real change has already been processed", async () => {
	vol.fromJSON({ [sourceFile]: "export const value = 1;" });

	const transpiler = new SwcTranspiler();
	const project = new Project(projectDir, { ...WorkspaceDefaults, rootDir });

	// Initial build
	await transpiler.transformProject(project);

	const file = new FileEx({
		fullPath: `/${sourceFile}`,
		relativePath: "src/index.ts",
	});
	const makeEvt = (): ProjectFileEvent => ({
		eventName: WatchEvents.change,
		project,
		configuration: "debug",
		file,
	});

	// Step 1: real change — should transpile
	vol.fromJSON({ [sourceFile]: "export const value = 2;" });
	await (transpiler as any).onIncrementalFileEvent(makeEvt());

	// Step 2: save without change (content still "2") — must NOT re-transpile
	const transformSpy = vi.spyOn(transpiler, "transformProject");
	await (transpiler as any).onIncrementalFileEvent(makeEvt());

	expect(transformSpy).not.toHaveBeenCalled();
});
