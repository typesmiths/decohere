import { resetMemfs } from "@decohere/testing";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PublishCommand } from "../../src/commands/publish.command.js";

beforeEach(() => {
	vi.spyOn(process, "cwd").mockReturnValue("/");
});

afterEach(() => {
	resetMemfs();
	vi.restoreAllMocks();
});

it("should define publish command metadata and options", () => {
	const cmd = new PublishCommand("publish");
	expect(cmd.name()).toBe("publish");
	expect(cmd.description()).toBe("Publish workspace packages");
	expect(cmd.options).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				flags: "--configuration <configuration>",
				defaultValue: "release",
			}),
			expect.objectContaining({ flags: "--dry-run [dryRun]", defaultValue: false }),
			expect.objectContaining({ flags: "--channel <channel>", defaultValue: "beta" }),
			expect.objectContaining({ flags: "--token <token>" }),
			expect.objectContaining({ flags: "--otp <otp>" }),
			expect.objectContaining({ flags: "--prompt-auth", defaultValue: false }),
			expect.objectContaining({ flags: "--prompt-otp", defaultValue: false }),
		]),
	);
});
