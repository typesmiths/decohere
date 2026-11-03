import path from "node:path";
import { WorkspaceFactory } from "@decohere/workspace";
import { Caching } from "@decohere/core/caching";
import { resetMemfs } from "@decohere/testing";
import { fs, vol } from "memfs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LINK_MANIFEST, Link } from "../../src/actions/link.action.js";
import { WorkspaceDefaults } from "../../src/workspace.config.js";

const PROJECT_NAME = "@mock/app";
const PROJECT_DIR = "projects/project1";
const OUT_DIR = `/dist/debug/${PROJECT_DIR}`;
const TARGET_DIR = "/consumer";

const mockFiles = {
	"/package.json": JSON.stringify({ name: "ROOT", version: "1.0.0" }),
	[`/${PROJECT_DIR}/package.json`]: JSON.stringify({ name: PROJECT_NAME }),
	[`/${PROJECT_DIR}/src/index.ts`]: "export const value = 1;",
	[`${OUT_DIR}/src/index.js`]: "export const value = 1;",
	[`${TARGET_DIR}/package.json`]: JSON.stringify({ name: "consumer" }),
	[`${TARGET_DIR}/node_modules/.keep`]: "",
};

beforeEach(() => {
	vi.spyOn(process, "cwd").mockReturnValue("/");
});

afterEach(() => {
	resetMemfs();
	Caching.flushAllCaches();
	vi.restoreAllMocks();
});

it("should symlink each workspace package into target node_modules", async () => {
	vol.fromJSON(mockFiles);

	const workspace = await WorkspaceFactory.create(WorkspaceDefaults);
	const linkAction = new Link(workspace);
	const response = await linkAction.run({ configuration: "debug", targetDir: TARGET_DIR });

	expect(response.succeeded).toBe(true);

	const symlinkPath = path.join(TARGET_DIR, "node_modules", "@mock", "app");
	const stat = fs.lstatSync(symlinkPath);
	expect(stat.isSymbolicLink()).toBe(true);
	expect(fs.readlinkSync(symlinkPath)).toBe(path.resolve(OUT_DIR));
});

it("should write a link manifest", async () => {
	vol.fromJSON(mockFiles);

	const workspace = await WorkspaceFactory.create(WorkspaceDefaults);
	const linkAction = new Link(workspace);
	await linkAction.run({ configuration: "debug", targetDir: TARGET_DIR });

	const manifestPath = path.join(TARGET_DIR, LINK_MANIFEST);
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8") as string);
	expect(manifest.links).toHaveLength(1);
	expect(manifest.links[0].packageName).toBe(PROJECT_NAME);
});

it("should link packages and pre-create output dir even when build output does not exist", async () => {
	const filesWithoutOutput = { ...mockFiles };
	delete filesWithoutOutput[`${OUT_DIR}/src/index.js`];
	vol.fromJSON(filesWithoutOutput);

	const workspace = await WorkspaceFactory.create(WorkspaceDefaults);
	const linkAction = new Link(workspace);
	const response = await linkAction.run({ configuration: "debug", targetDir: TARGET_DIR });

	expect(response.succeeded).toBe(true);
	const manifestPath = path.join(TARGET_DIR, LINK_MANIFEST);
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8") as string);
	expect(manifest.links).toHaveLength(1);
	expect(manifest.links[0].packageName).toBe(PROJECT_NAME);
	// The output dir should have been pre-created
	expect(fs.statSync(OUT_DIR).isDirectory()).toBe(true);
});

it("should throw when node_modules does not exist in target", async () => {
	vol.fromJSON({
		"/package.json": JSON.stringify({ name: "ROOT", version: "1.0.0" }),
		[`${TARGET_DIR}/package.json`]: JSON.stringify({ name: "consumer" }),
	});

	const workspace = await WorkspaceFactory.create(WorkspaceDefaults);
	const linkAction = new Link(workspace);

	await expect(
		linkAction.run({ configuration: "debug", targetDir: TARGET_DIR }),
	).rejects.toThrow("node_modules not found");
});

it("should preserve originalPath from the existing manifest when linked a second time", async () => {
	const pnpmTarget = "../.pnpm/@mock+app@1.0.0/node_modules/@mock/app";
	const symlinkPath = path.join(TARGET_DIR, "node_modules", "@mock", "app");

	vol.fromJSON(mockFiles);
	fs.mkdirSync(path.dirname(symlinkPath), { recursive: true });
	fs.symlinkSync(pnpmTarget, symlinkPath, "dir");

	const workspace = await WorkspaceFactory.create(WorkspaceDefaults);
	const linkAction = new Link(workspace);

	// First link — replaces the pnpm symlink and records its target as originalPath
	await linkAction.run({ configuration: "debug", targetDir: TARGET_DIR });

	// Second link — should preserve the original pnpm target, not overwrite with the forge build dir
	await linkAction.run({ configuration: "debug", targetDir: TARGET_DIR });

	const manifestPath = path.join(TARGET_DIR, LINK_MANIFEST);
	const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8") as string);
	expect(manifest.links[0].originalPath).toBe(pnpmTarget);
});
