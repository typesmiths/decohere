import fs from "node:fs";
import { Tsconfig } from "@decohere/workspace";
import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { afterEach, expect, it, vi } from "vitest";
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

it("should report error if extends file not found", async () => {
	vol.fromJSON({
		"path/to/MOCK.ts": "",
		"path/tsconfig.json": JSON.stringify({
			extends: "../MOCK.json",
		}),
		"tsconfig.json": "",
	});

	const config = await Tsconfig.parse("path/tsconfig.json");
	expect(config.errors).toHaveLength(1);
	expect(config.errors).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				messageText: expect.stringMatching(/Cannot read file '.*MOCK\.json'/),
			}),
		]),
	);
});

it("should not crash when tsconfig is at a relative path with no include patterns", async () => {
	// The workspace-level tsconfig.json has no include/files, so TypeScript enumerates
	// files from the basePath. Tsconfig.parse() passes path.dirname(filePath) = "." to
	// ts.parseJsonConfigFileContent, which TypeScript normalizes internally to "".
	// On a real filesystem readdirSync("") throws ENOENT; memfs silently resolves it to
	// CWD, masking the bug. This spy enforces real-filesystem behaviour so the test fails
	// without the fix (pass an absolute basePath to parseJsonConfigFileContent).
	vol.fromJSON({
		"tsconfig.json": JSON.stringify({
			compilerOptions: { declaration: true, emitDeclarationOnly: true },
		}),
	});

	const realReaddirSync = fs.readdirSync.bind(fs);
	vi.spyOn(fs, "readdirSync").mockImplementation((p, ...args) => {
		if (p === "") {
			throw Object.assign(new Error("ENOENT: no such file or directory, scandir ''"), {
				errno: -2,
				code: "ENOENT",
				syscall: "scandir",
				path: "",
			});
		}
		return realReaddirSync(p, ...(args as [any]));
	});

	await expect(Tsconfig.parse("tsconfig.json")).resolves.toBeDefined();
});
