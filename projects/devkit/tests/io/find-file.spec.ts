import * as glob from "glob";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { findFile, findFiles } from "../../src/io/find-file.js";

vi.mock("glob");

describe("findFile", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should fail fast when glob is not explicitly overridden", async () => {
		await expect(findFile("**/*.ts")).rejects.toThrow(
			'Mocked "glob" was called without an explicit test override.',
		);
	});

	it("should return file with relativePath when pattern matches", async () => {
		vi.spyOn(glob, "glob").mockResolvedValue(["src/index.ts"]);

		const result = await findFile("**/*.ts");

		expect(result).toEqual({
			relativePath: "src/index.ts",
		});
	});

	it("should return undefined when no files match", async () => {
		vi.spyOn(glob, "glob").mockResolvedValue([]);

		const result = await findFile("**/*.ts");

		expect(result).toBeUndefined();
	});

	it("should return only the first match", async () => {
		vi.spyOn(glob, "glob").mockResolvedValue(["src/index.ts", "src/utils.ts"]);

		const result = await findFile("**/*.ts");

		expect(result).toEqual({
			relativePath: "src/index.ts",
		});
	});
});

describe("findFiles", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should transform glob Path objects to File objects with relativePath and fullPath", async () => {
		// Mock glob Path objects
		const mockGlobPaths = [
			{
				isFile: () => true,
				relative: () => "src/index.ts",
				fullpath: () => "/test/project/src/index.ts",
			},
			{
				isFile: () => true,
				relative: () => "src/utils.ts",
				fullpath: () => "/test/project/src/utils.ts",
			},
		];

		vi.spyOn(glob, "glob").mockResolvedValue(mockGlobPaths as unknown as string[]);

		const result = await findFiles(["**/*.ts"], {
			cwd: "/test/project",
			ignore: [],
		});

		expect(result).toHaveLength(2);
		expect(result[0]).toEqual({
			relativePath: "src/index.ts",
			fullPath: "/test/project/src/index.ts",
		});
		expect(result[1]).toEqual({
			relativePath: "src/utils.ts",
			fullPath: "/test/project/src/utils.ts",
		});
	});

	it("should use p.relative() for relativePath, not p.name", async () => {
		// This test verifies the bug fix where p.name was incorrectly used
		const mockGlobPaths = [
			{
				isFile: () => true,
				name: "index.ts", // This would be wrong to use
				relative: () => "src/components/index.ts", // This is correct
				fullpath: () => "/test/project/src/components/index.ts",
			},
		];

		vi.spyOn(glob, "glob").mockResolvedValue(mockGlobPaths as unknown as string[]);

		const result = await findFiles(["**/*.ts"], {
			cwd: "/test/project",
			ignore: [],
		});

		// Assert that we get the full relative path, not just the filename
		expect(result[0].relativePath).toBe("src/components/index.ts");
		expect(result[0].relativePath).not.toBe("index.ts");
	});

	it("should filter out directories and only return files", async () => {
		const mockGlobPaths = [
			{
				isFile: () => true,
				relative: () => "src/index.ts",
				fullpath: () => "/test/project/src/index.ts",
			},
			{
				isFile: () => false, // Directory
				relative: () => "src/components",
				fullpath: () => "/test/project/src/components",
			},
			{
				isFile: () => true,
				relative: () => "src/utils.ts",
				fullpath: () => "/test/project/src/utils.ts",
			},
		];

		vi.spyOn(glob, "glob").mockResolvedValue(mockGlobPaths as unknown as string[]);

		const result = await findFiles(["**/*.ts"], {
			cwd: "/test/project",
			ignore: [],
		});

		expect(result).toHaveLength(2);
		expect(result.map((f) => f.relativePath)).toEqual(["src/index.ts", "src/utils.ts"]);
	});

	it("should handle empty results", async () => {
		vi.spyOn(glob, "glob").mockResolvedValue([]);

		const result = await findFiles(["**/*.ts"], {
			cwd: "/test/project",
			ignore: [],
		});

		expect(result).toEqual([]);
	});

	it("should pass options to glob correctly", async () => {
		const globSpy = vi.spyOn(glob, "glob").mockResolvedValue([]);

		await findFiles(["**/*.ts", "**/*.js"], {
			cwd: "/test/project",
			ignore: ["**/*.spec.ts"],
		});

		expect(globSpy).toHaveBeenCalledWith(
			["**/*.ts", "**/*.js"],
			expect.objectContaining({
				cwd: "/test/project",
				ignore: ["**/*.spec.ts"],
				withFileTypes: true,
			}),
		);
	});

	it("should work with nested directory structures", async () => {
		const mockGlobPaths = [
			{
				isFile: () => true,
				relative: () => "deep/nested/path/to/file.ts",
				fullpath: () => "/test/project/deep/nested/path/to/file.ts",
			},
		];

		vi.spyOn(glob, "glob").mockResolvedValue(mockGlobPaths as unknown as string[]);

		const result = await findFiles(["**/*.ts"], {
			cwd: "/test/project",
			ignore: [],
		});

		expect(result[0]).toEqual({
			relativePath: "deep/nested/path/to/file.ts",
			fullPath: "/test/project/deep/nested/path/to/file.ts",
		});
	});
});
