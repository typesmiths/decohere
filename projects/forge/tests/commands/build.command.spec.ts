import { resetMemfs } from "@decohere/testing";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BuildCommand } from "../../src/commands/build.command.js";

beforeEach(() => {
	vi.spyOn(process, "cwd").mockReturnValue("/");
});

afterEach(() => {
	resetMemfs();
	vi.restoreAllMocks();
});

it("should define build command metadata and options", () => {
	const cmd = new BuildCommand("build");
	expect(cmd.name()).toBe("build");
	expect(cmd.description()).toBe("Build workspace projects");
	expect(cmd.options).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ flags: "--no-clean", defaultValue: true }),
			expect.objectContaining({ flags: "--no-copy", defaultValue: true }),
			expect.objectContaining({ flags: "--watch", defaultValue: false }),
			expect.objectContaining({ flags: "--file <file>", defaultValue: undefined }),
		]),
	);
});
