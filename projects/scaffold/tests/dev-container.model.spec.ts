import { describe, expect, it } from "vitest";
import { DevContainer } from "../src/models/dev-container.model.js";

describe("DevContainer", () => {
	it("renders postCreateCommand and updateContentCommand when set", () => {
		const files = new DevContainer()
			.setPostCreateCommand("bash .devcontainer/post-create.sh")
			.setUpdateContentCommand("bash .devcontainer/post-create.sh")
			.setPostStartCommand("bash .devcontainer/post-start.sh")
			.useCompose()
			.files();

		const json = JSON.parse(files[0]!.content) as Record<string, unknown>;
		expect(json.postCreateCommand).toBe("bash .devcontainer/post-create.sh");
		expect(json.updateContentCommand).toBe("bash .devcontainer/post-create.sh");
		expect(json.postStartCommand).toBe("bash .devcontainer/post-start.sh");
		expect(json.workspaceFolder).toBe("/workspace");
		expect(json).not.toHaveProperty("initializeCommand");
	});

	it("setWorkspaceFolder drives workspaceFolder and bind mount target", () => {
		const files = new DevContainer().setWorkspaceFolder("/crypto").useCompose().files();
		const first = files[0];
		expect(first).toBeDefined();
		const json = JSON.parse(first.content) as {
			workspaceFolder?: string;
			mounts?: string[];
		};
		expect(json.workspaceFolder).toBe("/crypto");
		expect(json.mounts).toEqual(["source=..,target=/crypto,type=bind,consistency=cached"]);
	});

	it("omits install lifecycle keys when unset", () => {
		const files = new DevContainer()
			.setPostStartCommand("bash .devcontainer/post-start.sh")
			.files();
		const json = JSON.parse(files[0]!.content) as Record<string, unknown>;
		expect(json).not.toHaveProperty("postCreateCommand");
		expect(json).not.toHaveProperty("updateContentCommand");
		expect(json.postStartCommand).toBe("bash .devcontainer/post-start.sh");
	});
});
