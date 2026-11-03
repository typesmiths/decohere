import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSpawnSync } = vi.hoisted(() => ({
	mockSpawnSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	spawnSync: mockSpawnSync,
}));

const { formatScaffoldedFiles } = await import("../src/webapi/features/biome-format.js");

beforeEach(() => {
	mockSpawnSync.mockReset();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("formatScaffoldedFiles", () => {
	it("runs biome check --write in the target directory", () => {
		mockSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "", error: undefined });

		formatScaffoldedFiles("/tmp/scaffold");

		expect(mockSpawnSync).toHaveBeenCalledWith(
			"biome",
			["check", "--write", "."],
			expect.objectContaining({ cwd: "/tmp/scaffold" }),
		);
	});

	it("falls back to npx when biome is not on PATH", () => {
		const enoent = Object.assign(new Error("not found"), { code: "ENOENT" });
		mockSpawnSync
			.mockReturnValueOnce({ status: 1, stdout: "", stderr: "", error: enoent })
			.mockReturnValueOnce({ status: 0, stdout: "", stderr: "", error: undefined });

		formatScaffoldedFiles("/tmp/scaffold");

		expect(mockSpawnSync).toHaveBeenNthCalledWith(
			2,
			"npx",
			["--yes", "@biomejs/biome", "check", "--write", "."],
			expect.objectContaining({ cwd: "/tmp/scaffold" }),
		);
	});
});
