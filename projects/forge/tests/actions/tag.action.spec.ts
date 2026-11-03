import { WorkspaceFactory } from "@decohere/workspace";
import { Git } from "@decohere/devkit/interop";
import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { afterEach, expect, it, vi } from "vitest";
import { Tag } from "../../src/actions/tag.action.js";
import { ForgeError } from "../../src/errors.js";
import { WorkspaceDefaults } from "../../src/workspace.config.js";

const version = "1.2.3";
const mockFiles = {
	"/package.json": JSON.stringify({ name: "ROOT", version }),
	"/projects/proj1/package.json": JSON.stringify({ name: "proj1", version }),
	"/projects/proj1/src/index.ts": "export const value = 1;",
};

afterEach(() => {
	resetMemfs();
	vi.restoreAllMocks();
});

it("should call git tag with default v prefix", async () => {
	vol.fromJSON(mockFiles);
	vi.spyOn(process, "cwd").mockReturnValue("/");
	const tagSpy = vi.spyOn(Git.prototype, "tag").mockResolvedValue({ message: "", data: [] });
	const workspace = await WorkspaceFactory.create(WorkspaceDefaults);
	const action = new Tag(workspace);
	const response = await action.run({ dryRun: false });

	expect(tagSpy).toHaveBeenCalledWith("v1.2.3");
	expect(response.succeeded).toBe(true);
	expect(response.data[0].tag).toBe("v1.2.3");
});

it("should support a custom prefix", async () => {
	vol.fromJSON(mockFiles);
	vi.spyOn(process, "cwd").mockReturnValue("/");
	const tagSpy = vi.spyOn(Git.prototype, "tag").mockResolvedValue({ message: "", data: [] });
	const workspace = await WorkspaceFactory.create(WorkspaceDefaults);
	const action = new Tag(workspace);
	await action.run({ prefix: "release-", dryRun: false });

	expect(tagSpy).toHaveBeenCalledWith("release-1.2.3");
});

it("should not call git when dry-run is set", async () => {
	vol.fromJSON(mockFiles);
	vi.spyOn(process, "cwd").mockReturnValue("/");
	const tagSpy = vi.spyOn(Git.prototype, "tag").mockResolvedValue({ message: "", data: [] });
	const workspace = await WorkspaceFactory.create(WorkspaceDefaults);
	const action = new Tag(workspace);
	const response = await action.run({ dryRun: true });

	expect(tagSpy).not.toHaveBeenCalled();
	expect(response.succeeded).toBe(true);
	expect(response.data[0].tag).toBe("v1.2.3");
});

it("should push only the tag when push is set", async () => {
	vol.fromJSON(mockFiles);
	vi.spyOn(process, "cwd").mockReturnValue("/");
	const tagSpy = vi.spyOn(Git.prototype, "tag").mockResolvedValue({ message: "", data: [] });
	const pushSpy = vi.spyOn(Git.prototype, "push").mockResolvedValue({ message: "", data: [] });
	const pushTagSpy = vi
		.spyOn(Git.prototype, "pushTag")
		.mockResolvedValue({ message: "", data: [] });
	const workspace = await WorkspaceFactory.create(WorkspaceDefaults);
	const action = new Tag(workspace);
	const response = await action.run({ push: true, dryRun: false });

	expect(tagSpy).toHaveBeenCalledWith("v1.2.3");
	expect(pushTagSpy).toHaveBeenCalledWith("v1.2.3");
	expect(pushSpy).not.toHaveBeenCalled();
	expect(response.succeeded).toBe(true);
});

it("should throw a ForgeError when git pushTag fails", async () => {
	vol.fromJSON(mockFiles);
	vi.spyOn(process, "cwd").mockReturnValue("/");
	vi.spyOn(Git.prototype, "tag").mockResolvedValue({ message: "", data: [] });
	vi.spyOn(Git.prototype, "pushTag").mockRejectedValue(
		new Error(
			"Running 'git push origin v1.2.3' failed with code 1\nstderr:\nerror: failed to push some refs",
		),
	);

	const workspace = await WorkspaceFactory.create(WorkspaceDefaults);
	const action = new Tag(workspace);

	await expect(action.run({ push: true, dryRun: false })).rejects.toThrow(ForgeError);
});
