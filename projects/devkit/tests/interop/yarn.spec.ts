import { describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn());

vi.mock("../../src/interop/shell/shell.js", () => ({
	Shell: class {
		public run = run;
	},
}));

import { Yarn } from "../../src/interop/yarn/yarn.js";

describe("Yarn", () => {
	it("calls install with no extra flags", async () => {
		await new Yarn().install({ cwd: "/workspace" });
		expect(run).toHaveBeenCalledWith({ cwd: "/workspace" }, "install");
	});
});
