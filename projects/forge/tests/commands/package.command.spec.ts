import { expect, it, vi } from "vitest";
import { PackageCommand } from "../../src/commands/package.command.js";

it("defines the package command with an optional project argument", () => {
	const cmd = new PackageCommand("package");

	expect(cmd.name()).toBe("package");
	expect(
		cmd.registeredArguments.map((argument) => [argument.name(), argument.required]),
	).toEqual([["project", false]]);
});

it("hands the project argument to the handler as an option", async () => {
	const handler = vi.fn(async (_opts: unknown, command: PackageCommand) => {
		expect(command.getOptionValue("project")).toBe("@app/api");
	});
	const cmd = new PackageCommand("package");
	cmd.action(handler);

	await cmd.parseAsync(["@app/api"], { from: "user" });

	expect(handler).toHaveBeenCalledTimes(1);
});

it("leaves project unset when no argument is given", async () => {
	const handler = vi.fn(async (_opts: unknown, command: PackageCommand) => {
		expect(command.getOptionValue("project")).toBeUndefined();
	});
	const cmd = new PackageCommand("package");
	cmd.action(handler);

	await cmd.parseAsync([], { from: "user" });

	expect(handler).toHaveBeenCalledTimes(1);
});
