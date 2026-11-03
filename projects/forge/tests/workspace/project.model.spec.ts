import path from "node:path";
import { PackageJson, Project } from "@decohere/workspace";
import { FileEx, FileEx as FileExModel } from "@decohere/core/io";
import { resetMemfs } from "@decohere/testing";
import { fs, vol } from "memfs";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Debug, Release, WorkspaceDefaults } from "../../src/workspace.config.js";

beforeEach(() => {
	vol.reset();
});

afterEach(() => {
	resetMemfs();
});

it("should require a name", () => {
	expect(() => new Project("MOCK", WorkspaceDefaults, Debug.name)).not.toThrow();
});

it("should use default dist out", () => {
	const project = new Project("MOCK", WorkspaceDefaults, Debug.name);
	expect(project.getOutDir().startsWith("dist/debug/MOCK")).toBe(true);
});

it("should use default include", () => {
	const project = new Project("MOCK", WorkspaceDefaults, Debug.name);
	expect(project.include).toEqual(WorkspaceDefaults.include);
});

it("should use default ignore", () => {
	const project = new Project("MOCK", WorkspaceDefaults, Debug.name);
	expect(project.ignore).toEqual([
		...(WorkspaceDefaults.ignore ?? []),
		...(Debug.ignore ?? []),
	]);
});

it("should use build config for outDir", () => {
	const project = new Project("MOCK", WorkspaceDefaults, Debug.name);
	expect(project.getOutDir().startsWith("dist/debug")).toBe(true);
});

it("should use default buildconfigs", () => {
	const project = new Project("MOCK", WorkspaceDefaults, Debug.name);
	expect(project.configurations).toContain(Debug);
	expect(project.configurations).toContain(Release);
});

it("should calculate project directory from name", () => {
	const project = new Project("MOCK", WorkspaceDefaults, Debug.name);
	expect(project.projectDirectory).toBe("MOCK");
});

it("should should load source files relative to project dir", async () => {
	const projName = "MOCK";
	vol.fromJSON({
		[path.join(projName, "src", "index.ts")]: "",
	});
	const project = new Project("MOCK", WorkspaceDefaults, Debug.name);
	const files = await project.getAllFiles();
	expect(files.at(0).relativePath).toBe(path.join("src", "index.ts"));
});

it("should load source files in include pattern only", async () => {
	const projName = "MOCK";
	vol.fromJSON({
		[path.join(projName, "src", "index.ts")]: "",
		[path.join(projName, "src", "index.spec.ts")]: "",
	});
	const project = new Project(projName, {
		...WorkspaceDefaults,
		include: ["src/**/*.ts"],
		ignore: ["**/*.spec.ts"],
	});
	const files = await project.getAllFiles();
	expect(files).toHaveLength(1);
	const file = new FileEx({ relativePath: path.join("src", "index.ts") });
	expect(project.isSourceFile(file)).toBe(true);
});

it("should exclude ignored files even when they match include", async () => {
	const projName = "MOCK";
	vol.fromJSON({
		[path.join(projName, "src", "index.ts")]: "",
		[path.join(projName, "src", "index.spec.ts")]: "",
	});
	const project = new Project(projName, {
		...WorkspaceDefaults,
		include: ["src/**/*.ts"],
		ignore: ["**/*.spec.ts"],
	});
	await project.getAllFiles();
	const includedFile = new FileEx({ relativePath: path.join("src", "index.ts") });
	const ignoredFile = new FileEx({ relativePath: path.join("src", "index.spec.ts") });
	expect(project.isSourceFile(includedFile)).toBe(true);
	expect(project.isSourceFile(ignoredFile)).toBe(false);
});

it("should exclude files that do not match include", async () => {
	const projName = "MOCK";
	vol.fromJSON({
		[path.join(projName, "src", "index.ts")]: "",
		[path.join(projName, "src", "index.MOCK")]: "",
	});
	const project = new Project(projName, {
		...WorkspaceDefaults,
		include: ["src/**/*.ts"],
		ignore: ["**/*.MOCK"],
	});

	await project.getAllFiles();
	const includedFile = new FileEx({ relativePath: path.join("src", "index.ts") });
	const ignoredFile = new FileEx({ relativePath: path.join("src", "index.MOCK") });
	expect(project.isSourceFile(includedFile)).toBe(true);
	expect(project.isSourceFile(ignoredFile)).toBe(false);
});

it("should add new source files to the cached source file map while watching", async () => {
	const projectDir = "MOCK";
	const newFilePath = path.join(projectDir, "src", "new.ts");
	vol.fromJSON({
		[path.join(projectDir, "src", "index.ts")]: "export const value = 1;",
	});

	const project = new Project("MOCK", WorkspaceDefaults, Debug.name);
	await project.getAllFiles();

	await new Promise<void>((resolve, reject) => {
		project
			.watch("debug")
			.then((watcher) => {
				const subscription = project.projectFileChanged$.subscribe((evt) => {
					if (evt.eventName !== "add" || evt.file.relativePath !== "src/new.ts") {
						return;
					}

					subscription.unsubscribe();
					watcher.close();
					resolve();
				});

				watcher.ready.then(() => {
					fs.writeFileSync(newFilePath, "export const value = 2;", { encoding: "utf8" });
				});

				setTimeout(() => {
					subscription.unsubscribe();
					watcher.close();
					reject(new Error("expected add event was not emitted for new source file"));
				}, 800);
			})
			.catch(reject);
	});

	const file = new FileExModel({ fullPath: newFilePath, relativePath: "src/new.ts" });
	expect(project.isSourceFile(file as FileEx)).toBe(true);
});

it("should remove deleted source files from the cached source file map while watching", async () => {
	const projectDir = "MOCK";
	const filePath = path.join(projectDir, "src", "index.ts");
	vol.fromJSON({
		[filePath]: "export const value = 1;",
	});

	const project = new Project("MOCK", WorkspaceDefaults, Debug.name);
	await project.getAllFiles();

	await new Promise<void>((resolve, reject) => {
		project
			.watch("debug")
			.then((watcher) => {
				const subscription = project.projectFileChanged$.subscribe((evt) => {
					if (evt.eventName !== "unlink" || evt.file.relativePath !== "src/index.ts") {
						return;
					}

					subscription.unsubscribe();
					watcher.close();
					resolve();
				});

				watcher.ready.then(() => {
					fs.unlinkSync(filePath);
				});

				setTimeout(() => {
					subscription.unsubscribe();
					watcher.close();
					reject(new Error("expected unlink event was not emitted for deleted source file"));
				}, 800);
			})
			.catch(reject);
	});

	const file = new FileExModel({ fullPath: filePath, relativePath: "src/index.ts" });
	expect(project.isSourceFile(file as FileEx)).toBe(false);
});

it("should reflect updated dependencies after persistPackageJson", async () => {
	vol.fromJSON({
		"MOCK/package.json": JSON.stringify({
			name: "@ORG/MOCK",
			version: "1.0.0",
			dependencies: { axios: "^1.0.0" },
			devDependencies: {},
		}),
	});

	const project = new Project("MOCK", WorkspaceDefaults, Debug.name);
	const original = await project.getPackageJson();
	expect(original.dependencies).toEqual({ axios: "^1.0.0" });

	const updated = new PackageJson({ ...original, dependencies: { fastify: "^5.0.0" } });
	await project.persistPackageJson(updated);

	const reread = await project.getPackageJson();
	expect(reread.dependencies).toEqual({ fastify: "^5.0.0" });
});
