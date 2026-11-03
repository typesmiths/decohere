import { resetMemfs } from "@decohere/testing";
import { afterEach, expect, it, vi } from "vitest";
import { DockerCommand } from "../../src/commands/docker.command.js";

afterEach(() => {
	resetMemfs();
	vi.restoreAllMocks();
});

it("should define docker command metadata and options", () => {
	const cmd = new DockerCommand("docker");
	expect(cmd.name()).toBe("docker");
	expect(cmd.description()).toBe("Build Docker images for workspace projects");
	expect(cmd.options).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				flags: "--configuration <configuration>",
				defaultValue: "release",
			}),
			expect.objectContaining({
				flags: "--dry-run [dryRun]",
				description: "Build images without pushing to a registry",
				defaultValue: false,
			}),
			expect.objectContaining({ flags: "--push", defaultValue: false }),
		]),
	);
});
