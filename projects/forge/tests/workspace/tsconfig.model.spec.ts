import { Tsconfig } from "@decohere/workspace";
import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { afterEach, expect, it } from "vitest";
import { WorkspaceConfigurationError } from "../../src/errors.js";

afterEach(() => {
	resetMemfs();
});

it("should parse child tsconfig", async () => {
	vol.fromJSON({
		"path/tsconfig.json": JSON.stringify({
			extends: "../tsconfig.json",
			compilerOptions: { declaration: true },
		}),
		"tsconfig.json": JSON.stringify({
			compilerOptions: { declaration: false, emitDeclarationOnly: true },
		}),
	});

	const config = await Tsconfig.parse("path/tsconfig.json");
	expect(config.compilerOptions.declaration).toBe(true);
	expect(config.compilerOptions.emitDeclarationOnly).toBe(true);
});

it("should parse tsconfig", async () => {
	vol.fromJSON({
		"path/file.ts": "CONTENT",
		"tsconfig.json": JSON.stringify({
			compilerOptions: { declaration: false, emitDeclarationOnly: true },
		}),
	});

	const config = await Tsconfig.parse("tsconfig.json");
	expect(config.compilerOptions.declaration).toBe(false);
	expect(config.compilerOptions.emitDeclarationOnly).toBe(true);
});

it("should throw parse errors", async () => {
	vol.fromJSON({
		"tsconfig.json": "{",
	});

	const config = () => Tsconfig.parse("tsconfig.json");
	await expect(config).rejects.toThrow(WorkspaceConfigurationError);
	await expect(config).rejects.toThrow("Error parsing tsconfig.json");
});

it("should throw when file not found", async () => {
	vol.fromJSON({
		"tsconfig.json": "",
	});

	const config = () => Tsconfig.parse("MOCK");
	await expect(config).rejects.toThrow(WorkspaceConfigurationError);
	await expect(config).rejects.toThrow("TSConfig not found");
});

it("should throw if the extends file is not found", async () => {
	vol.fromJSON({
		"path/tsconfig.json": JSON.stringify({
			extends: "../MOCK.json",
		}),
	});

	const config = () => Tsconfig.parse("path/tsconfig.json");
	await expect(config).rejects.toThrow(WorkspaceConfigurationError);
	await expect(config).rejects.toThrow(/Error parsing path\/tsconfig\.json.*MOCK\.json/);
});

it("resolves baseUrl and keeps paths from an extended tsconfig, without the TypeScript compiler", async () => {
	vol.fromJSON({
		"/ws/tsconfig.json": JSON.stringify({
			// A comment and a trailing comma, as tsconfig.json allows.
			compilerOptions: { baseUrl: ".", paths: { "@ws/lib": ["projects/lib/src/index.ts"] } },
		})
			.replace("{", "{ // root\n")
			.replace(/}$/, ",}"),
		"/ws/projects/app/tsconfig.json": JSON.stringify({ extends: "../../tsconfig.json" }),
	});

	const config = Tsconfig.parseSync("/ws/projects/app/tsconfig.json");

	expect(config.filePath).toBe("/ws/projects/app/tsconfig.json");
	expect(config.compilerOptions.baseUrl).toBe("/ws");
	expect(config.compilerOptions.paths).toEqual({ "@ws/lib": ["projects/lib/src/index.ts"] });
});
