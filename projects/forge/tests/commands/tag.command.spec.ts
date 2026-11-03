import { resetMemfs } from "@decohere/testing";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TagCommand } from "../../src/commands/tag.command.js";

beforeEach(() => {
	vi.spyOn(process, "cwd").mockReturnValue("/");
});

afterEach(() => {
	resetMemfs();
	vi.restoreAllMocks();
});

it("should define tag command metadata and options", () => {
	const cmd = new TagCommand("tag");
	expect(cmd.name()).toBe("tag");
	expect(cmd.description()).toBe(
		"Create and optionally push a git tag for the workspace version",
	);
	expect(cmd.options).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ flags: "--prefix <prefix>", defaultValue: "v" }),
			expect.objectContaining({ flags: "--push", defaultValue: false }),
			expect.objectContaining({ flags: "--dry-run [dryRun]", defaultValue: false }),
		]),
	);
});
