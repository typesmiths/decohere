import { expect, it } from "vitest";
import { DependencyCommand } from "../../src/commands/dependency.command.js";

it("should define dependencies command metadata, subcommands, and options", () => {
	const cmd = new DependencyCommand("dependencies");
	expect(cmd.name()).toBe("dependencies");
	expect(cmd.description()).toBe("Analyze and sync workspace dependencies");
	expect(cmd.options).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				flags: "--configuration <configuration>",
				defaultValue: "release",
			}),
		]),
	);

	const sync = cmd.commands.find((c) => c.name() === "sync");
	expect(sync).toBeDefined();
	expect(sync?.name()).toBe("sync");
	expect(sync?.description()).toBe("Sync workspace dependency manifests");
	expect(sync?.options).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ flags: "--log-diff", defaultValue: false }),
			expect.objectContaining({ flags: "--no-sync", defaultValue: true }),
			expect.objectContaining({ flags: "--commit", defaultValue: false }),
			expect.objectContaining({ flags: "--message <message>", defaultValue: undefined }),
		]),
	);

	const report = cmd.commands.find((c) => c.name() === "report");
	expect(report).toBeDefined();
	expect(report?.name()).toBe("report");
	expect(report?.description()).toBe("Report resolved dependencies for workspace projects");
	expect(report?.options).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ flags: "--file <file>", defaultValue: undefined }),
			expect.objectContaining({ flags: "--fail-on-drift", defaultValue: false }),
		]),
	);
});
