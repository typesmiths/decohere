import { UserConfigFactory } from "@decohere/workspace";
import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkspace } from "../src/create-workspace.js";
import { Release } from "../src/workspace.config.js";

afterEach(() => {
	resetMemfs();
	vi.restoreAllMocks();
});

describe("createWorkspace", () => {
	it("gives a project the per-project settings from .decohere.js", async () => {
		vol.fromJSON({
			"/ws/package.json": JSON.stringify({ name: "ws", version: "1.0.0" }),
			"/ws/projects/shop.api/package.json": JSON.stringify({
				name: "@app/shop.api",
				version: "1.0.0",
			}),
		});
		vi.spyOn(UserConfigFactory, "getUserConfig").mockResolvedValue({
			projects: {
				"@app/shop.api": {
					docker: { image: "ghcr.io/app/shop" },
					ui: { project: "@app/shop.web", output: "build" },
				},
			},
		});

		const workspace = await createWorkspace({ rootDir: "/ws" });

		const api = workspace.getProjects(Release.name).find((p) => p.name === "@app/shop.api");
		expect(api?.dockerConfig).toEqual({ image: "ghcr.io/app/shop" });
		expect(api?.uiConfig).toEqual({ project: "@app/shop.web", output: "build" });
	});
});
