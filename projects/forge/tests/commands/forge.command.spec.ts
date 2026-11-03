import { resetMemfs } from "@decohere/testing";
import type { OptionValues } from "commander";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ForgeCommand } from "../../src/commands/forge.command.js";

beforeEach(() => {
	vi.spyOn(process, "cwd").mockReturnValue("/");
});

afterEach(() => {
	resetMemfs();
	vi.restoreAllMocks();
});

it("should define forge command metadata and options", () => {
	const cmd = new ForgeCommand({}, async (_opts: OptionValues) => {});
	expect(cmd.name()).toBe("forge");
	expect(cmd.description()).toBe("Run forge workspace workflows");
	expect(cmd.options).toHaveLength(0);
});
