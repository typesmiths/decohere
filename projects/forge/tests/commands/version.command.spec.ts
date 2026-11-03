import { resetMemfs } from "@decohere/testing";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VersionCommand } from "../../src/commands/version.command.js";

beforeEach(() => {
	vi.spyOn(process, "cwd").mockReturnValue("/");
});

afterEach(() => {
	resetMemfs();
	vi.restoreAllMocks();
});

it("should define version command metadata and options", () => {
	const cmd = new VersionCommand("version");
	expect(cmd.name()).toBe("version");
	expect(cmd.description()).toBe("Bump workspace package versions");
	expect(cmd.options).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				flags: "--configuration <configuration>",
				defaultValue: "release",
			}),
			expect.objectContaining({ flags: "--dry-run [dryRun]", defaultValue: false }),
			expect.objectContaining({
				flags: "--release-type <releaseType>",
				defaultValue: "prerelease",
			}),
			expect.objectContaining({ flags: "--channel <channel>", defaultValue: "beta" }),
			expect.objectContaining({ flags: "--version <version>", defaultValue: undefined }),
			expect.objectContaining({ flags: "--no-sync", defaultValue: true }),
			expect.objectContaining({ flags: "--commit", defaultValue: false }),
			expect.objectContaining({ flags: "--message <message>", defaultValue: undefined }),
			expect.objectContaining({ flags: "--from-changesets", defaultValue: false }),
		]),
	);
});
