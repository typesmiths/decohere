import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSpawnSync } = vi.hoisted(() => ({
	mockSpawnSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	spawnSync: mockSpawnSync,
}));

const { PRETTIER_VERSION } = await import("../src/models/package-json.model.js");
const { formatScaffoldedFiles } = await import("../src/webapi/features/format-files.js");

beforeEach(() => {
	mockSpawnSync.mockReset();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("formatScaffoldedFiles", () => {
	it("runs prettier --write in the target directory", () => {
		mockSpawnSync.mockReturnValue({ status: 0, stdout: "", stderr: "", error: undefined });

		formatScaffoldedFiles("/tmp/scaffold");

		expect(mockSpawnSync).toHaveBeenCalledWith(
			"prettier",
			["--write", "."],
			expect.objectContaining({ cwd: "/tmp/scaffold" }),
		);
	});

	it("falls back to npx, at the version projects get, when prettier is not on PATH", () => {
		const enoent = Object.assign(new Error("not found"), { code: "ENOENT" });
		mockSpawnSync
			.mockReturnValueOnce({ status: 1, stdout: "", stderr: "", error: enoent })
			.mockReturnValueOnce({ status: 0, stdout: "", stderr: "", error: undefined });

		formatScaffoldedFiles("/tmp/scaffold");

		expect(mockSpawnSync).toHaveBeenNthCalledWith(
			2,
			"npx",
			["--yes", `prettier@${PRETTIER_VERSION}`, "--write", "."],
			expect.objectContaining({ cwd: "/tmp/scaffold" }),
		);
	});
});
