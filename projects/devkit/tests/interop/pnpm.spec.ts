import { beforeEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());

vi.mock("../../src/interop/shell/shell.js", () => ({
	Shell: class {
		public run = run;
	},
}));

import { Pnpm } from "../../src/interop/pnpm/pnpm.js";

describe("Pnpm", () => {
	beforeEach(() => run.mockClear());

	it("uses lockfile-only install flags when syncing lockfile", async () => {
		await new Pnpm().syncLockFile({ cwd: "/workspace" });
		expect(run).toHaveBeenCalledWith(
			{ cwd: "/workspace" },
			"install",
			"--lockfile-only",
			"--ignore-scripts",
		);
	});

	it("calls install with no extra flags", async () => {
		await new Pnpm().install({ cwd: "/workspace" });
		expect(run).toHaveBeenCalledWith({ cwd: "/workspace" }, "install");
	});
});
