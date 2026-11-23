import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSpawnSync } = vi.hoisted(() => ({
	mockSpawnSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	spawnSync: mockSpawnSync,
}));

import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
const { formatScaffoldedFiles } = await import("../src/webapi/format-files.js");

beforeEach(() => {
	mockSpawnSync.mockReset();
});

afterEach(() => {
	resetMemfs();
	vi.clearAllMocks();
});

describe("formatScaffoldedFiles", () => {
	it("runs prettier --write in the target directory", () => {
		mockSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "", error: undefined });

		formatScaffoldedFiles("/tmp/scaffold");

		expect(mockSpawnSync).toHaveBeenCalledWith(
			"prettier",
			["--write", "--ignore-unknown", "."],
			expect.objectContaining({ cwd: "/tmp/scaffold" }),
		);
	});

	it("falls back to npx, at the version the workspace pins, when prettier is not on PATH", () => {
		vol.fromJSON({
			"/tmp/scaffold/package.json": JSON.stringify({
				devDependencies: { prettier: "3.9.10" },
			}),
		});
		const enoent = Object.assign(new Error("not found"), { code: "ENOENT" });
		mockSpawnSync
			.mockReturnValueOnce({ status: 1, stdout: "", stderr: "", error: enoent })
			.mockReturnValueOnce({ status: 0, stdout: "", stderr: "", error: undefined });

		formatScaffoldedFiles("/tmp/scaffold");

		expect(mockSpawnSync).toHaveBeenNthCalledWith(
			2,
			"npx",
			["--yes", "prettier@3.9.10", "--write", "--ignore-unknown", "."],
			expect.objectContaining({ cwd: "/tmp/scaffold" }),
		);
	});
});
