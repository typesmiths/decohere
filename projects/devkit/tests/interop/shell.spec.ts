import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { Shell } from "../../src/interop/shell/shell.js";

vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
}));

class TestShell extends Shell {
	protected program = "missing-program";

	public runCommand() {
		return this.run({}, "arg");
	}
}

describe("Shell", () => {
	it("rejects when spawn emits an error", async () => {
		const childProcess = new EventEmitter() as EventEmitter & {
			stdout: EventEmitter;
		};
		childProcess.stdout = new EventEmitter();

		vi.mocked(spawn).mockReturnValue(childProcess as never);

		const shell = new TestShell();
		const runPromise = shell.runCommand();

		let settled = false;
		let rejected = false;
		runPromise
			.then(() => {
				settled = true;
			})
			.catch(() => {
				settled = true;
				rejected = true;
			});

		childProcess.emit("error", new Error("spawn ENOENT"));
		await new Promise((resolve) => setTimeout(resolve, 0));

		expect(settled).toBe(true);
		expect(rejected).toBe(true);
	});
});
