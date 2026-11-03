import { resetMemfs } from "@decohere/testing";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TypeCheckCommand } from "../../src/commands/typecheck.command.js";

beforeEach(() => {
	vi.spyOn(process, "cwd").mockReturnValue("/");
});

afterEach(() => {
	resetMemfs();
	vi.restoreAllMocks();
});

it("should define typecheck command metadata and options", () => {
	const cmd = new TypeCheckCommand("typecheck");
	expect(cmd.name()).toBe("typecheck");
	expect(cmd.description()).toBe("Type-check workspace projects without emitting files");
	expect(cmd.options).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				flags: "--configuration <configuration>",
				defaultValue: "debug",
			}),
		]),
	);
});
