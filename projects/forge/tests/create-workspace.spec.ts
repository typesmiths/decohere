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

describe("createWorkspace and ignoreProjects in .decohere.js", () => {
	const files = {
		"/ws/package.json": JSON.stringify({ name: "ws", version: "1.0.0" }),
		"/ws/projects/web/package.json": JSON.stringify({ name: "@app/web", version: "1.0.0" }),
		"/ws/projects/infra/package.json": JSON.stringify({
			name: "@app/infra",
			version: "1.0.0",
		}),
		// Not inside another project, so only the defaults' "**/dist/**" leaves it out.
		"/ws/projects/old/dist/package.json": JSON.stringify({ name: "@app/old-build" }),
	};

	it("leaves out the projects the user's file ignores, and still the defaults' ones", async () => {
		vol.fromJSON(files);
		vi.spyOn(UserConfigFactory, "getUserConfig").mockResolvedValue({
			ignoreProjects: ["projects/infra/**"],
		});

		const workspace = await createWorkspace({ rootDir: "/ws" });

		expect(workspace.getProjects(Release.name).map((p) => p.name)).toEqual(["@app/web"]);
	});
});
