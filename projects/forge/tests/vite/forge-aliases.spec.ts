import path from "node:path";
import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspace } from "../../src/create-workspace.js";
import {
	aliasResolver,
	findWorkspaceRoot,
	forgeAliases,
} from "../../src/vite/forge-aliases.plugin.js";

afterEach(() => {
	resetMemfs();
});

const WORKSPACE = {
	"/ws/package.json": JSON.stringify({ name: "ws" }),
	"/ws/projects/ui/package.json": JSON.stringify({
		name: "@ws/ui",
		exports: { "./*": "./src/*" },
	}),
	"/ws/projects/ui/src/Button.astro": "---\n---\n<button />",
	"/ws/projects/ui/src/format.ts": "export const format = (s: string) => s;",
	"/ws/projects/ui/src/theme.css": "",
	"/ws/projects/clubs/lions/web/package.json": JSON.stringify({ name: "@ws/lions.web" }),
	"/ws/projects/clubs/lions/web/src/pages/index.astro": "",
};
const SITE = "/ws/projects/clubs/lions/web";
const PAGE = `${SITE}/src/pages/index.astro`;

describe("findWorkspaceRoot", () => {
	it("is the folder whose projects/ holds the site", () => {
		vol.fromJSON(WORKSPACE);
		expect(findWorkspaceRoot(SITE)).toBe("/ws");
	});

	it("is the nearest folder with a .decohere.js, for a workspace laid out its own way", () => {
		vol.fromJSON({
			"/repo/.decohere.js": "export default {};",
			"/repo/apps/site/package.json": "{}",
		});
		expect(findWorkspaceRoot("/repo/apps/site")).toBe("/repo");
	});

	it("doesn't pass a nearer workspace for a .decohere.js further up", () => {
		vol.fromJSON({ ...WORKSPACE, "/.decohere.js": "export default {};" });
		expect(findWorkspaceRoot(SITE)).toBe("/ws");
	});

	it("says how to name it when there is none", () => {
		vol.fromJSON({ "/lone/package.json": "{}" });
		expect(() => findWorkspaceRoot("/lone")).toThrow(/workspaceRoot/);
	});
});

describe("aliasResolver", () => {
	const resolver = (fromRegistry?: string[]) =>
		aliasResolver(() => createWorkspace({ rootDir: "/ws" }), fromRegistry);

	it("resolves a workspace package by name to any file in its source", async () => {
		vol.fromJSON(WORKSPACE);
		const resolve = resolver();
		expect(await resolve("@ws/ui/Button.astro", PAGE)).toBe(
			path.resolve("/ws/projects/ui/src/Button.astro"),
		);
		expect(await resolve("@ws/ui/format", PAGE)).toBe(
			path.resolve("/ws/projects/ui/src/format.ts"),
		);
	});

	it("keeps Vite's query on the file", async () => {
		vol.fromJSON(WORKSPACE);
		expect(await resolver()("@ws/ui/theme.css?inline", PAGE)).toBe(
			`${path.resolve("/ws/projects/ui/src/theme.css")}?inline`,
		);
	});

	it("leaves everything else to Vite", async () => {
		vol.fromJSON(WORKSPACE);
		const resolve = resolver();
		expect(await resolve("astro:content", PAGE)).toBeNull();
		expect(await resolve("react", PAGE)).toBeNull();
		expect(await resolve("./local.ts", PAGE)).toBeNull();
		// A package that doesn't have the file: Vite reports it, not a guess.
		expect(await resolve("@ws/ui/Missing.astro", PAGE)).toBeNull();
		// Code in node_modules gets its own dependencies, not the workspace's.
		expect(await resolve("@ws/ui/format", "/ws/node_modules/x/index.js")).toBeNull();
	});

	it("leaves a package the project takes from the registry to node_modules", async () => {
		vol.fromJSON(WORKSPACE);
		expect(await resolver(["@ws/ui"])("@ws/ui/Button.astro", PAGE)).toBeNull();
	});
});

describe("forgeAliases", () => {
	it("lets Vite's dev server read the workspace's sources, outside the site's folder", () => {
		vol.fromJSON(WORKSPACE);
		expect(forgeAliases().config({ root: SITE })).toEqual({
			server: { fs: { allow: ["/ws"] } },
		});
	});
});
