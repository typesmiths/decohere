import { PackageJson, Tsconfig, Workspace } from "@decohere/workspace";
import { FileEx } from "@decohere/core/io";
import { vol } from "memfs";
import { expect, it } from "vitest";
import { ForgeError } from "../../src/errors.js";
import { SwcConfigFactory } from "../../src/factories/swc-config.factory.js";
import { BuildTargets } from "../../src/types/build-target.type.js";
import { WorkspaceDefaults } from "../../src/workspace.config.js";

it("baseUrl from tsconfig is resolved to absolute and passed to SWC config", () => {
	const file = new FileEx({ fullPath: "/project/src/index.ts" });
	const factory = new SwcConfigFactory();
	const tsConfig = new Tsconfig({ compilerOptions: { baseUrl: "." } });
	const config = factory.createFileConfig(
		file,
		factory.createBaseConfig(BuildTargets.es6, { tsConfig }),
	);
	expect(config.jsc?.baseUrl).toMatch(/^\//); // absolute path
});

it("userConfig baseUrl overrides tsconfig baseUrl", () => {
	const file = new FileEx({ fullPath: "/project/src/index.ts" });
	const factory = new SwcConfigFactory();
	const tsConfig = new Tsconfig({ compilerOptions: { baseUrl: "." } });
	const config = factory.createFileConfig(
		file,
		factory.createBaseConfig(BuildTargets.es6, {
			tsConfig,
			userConfig: { jsc: { baseUrl: "/override" } } as never,
		}),
	);
	expect(config.jsc?.baseUrl).toBe("/override");
});

it("baseUrl is undefined when not set in tsconfig or userConfig", () => {
	const file = new FileEx({ fullPath: "/project/src/index.ts" });
	const factory = new SwcConfigFactory();
	const config = factory.createFileConfig(
		file,
		factory.createBaseConfig(BuildTargets.es6, {}),
	);
	expect(config.jsc?.baseUrl).toBeUndefined();
});
it("validate: does not throw when baseUrl is undefined", () => {
	const factory = new SwcConfigFactory();
	expect(() => factory.validate({ jsc: {} })).not.toThrow();
	expect(() => factory.validate({})).not.toThrow();
});

it("validate: does not throw when baseUrl is an absolute path", () => {
	const factory = new SwcConfigFactory();
	expect(() => factory.validate({ jsc: { baseUrl: "/absolute/path" } })).not.toThrow();
});

it("validate: throws ForgeError when baseUrl is a relative path", () => {
	const factory = new SwcConfigFactory();
	expect(() => factory.validate({ jsc: { baseUrl: "./relative/path" } })).toThrow(ForgeError);
	expect(() => factory.validate({ jsc: { baseUrl: "relative" } })).toThrow(ForgeError);
});

it("validate: is called by createFileConfig and rejects a relative baseUrl", () => {
	const file = new FileEx({ fullPath: "/project/src/index.ts" });
	const factory = new SwcConfigFactory();
	expect(() => factory.createFileConfig(file, { jsc: { baseUrl: "./not-absolute" } })).toThrow(
		ForgeError,
	);
});

function aliasWorkspace() {
	const rootDir = "/";
	// Aliases point at entries that exist.
	vol.fromJSON({ "/projects/app/src/index.ts": "", "/projects/lib/src/index.ts": "" });
	return new Workspace({
		config: { ...WorkspaceDefaults, rootDir },
		projects: [
			{
				name: "hmr-app",
				config: {
					...WorkspaceDefaults,
					rootDir,
					projectDir: "projects/app",
					packageJson: new PackageJson({ name: "hmr-app", main: "src/index.ts" }),
				},
			},
			{
				name: "@hmr/lib",
				config: {
					...WorkspaceDefaults,
					rootDir,
					projectDir: "projects/lib",
					packageJson: new PackageJson({ name: "@hmr/lib", main: "src/index.ts" }),
				},
			},
		],
	});
}

it("builds convention aliases from workspace packages when aliasPaths is true", () => {
	const factory = new SwcConfigFactory();
	const config = factory.createBaseConfig(BuildTargets.es6, {
		aliasPaths: true,
		workspace: aliasWorkspace(),
	});

	expect(config.jsc?.paths?.["@hmr/lib"]).toEqual(["projects/lib/src/index.ts"]);
	expect(config.jsc?.paths?.["@hmr/lib/*"]).toEqual(["projects/lib/src/*"]);
});
