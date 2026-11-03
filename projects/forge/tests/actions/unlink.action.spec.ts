import path from "node:path";
import { Caching } from "@decohere/core/caching";
import { resetMemfs } from "@decohere/testing";
import { fs, vol } from "memfs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LINK_MANIFEST, type LinkManifest } from "../../src/actions/link.action.js";
import { Unlink } from "../../src/actions/unlink.action.js";

const TARGET_DIR = "/consumer";
const SYMLINK_PATH = `${TARGET_DIR}/node_modules/@mock/app`;
const REAL_DIR = "/dist/debug/projects/project1/es6";

function makeManifest(overrides?: Partial<LinkManifest>): LinkManifest {
	return {
		workspaceRoot: "/",
		links: [
			{
				packageName: "@mock/app",
				symlinkPath: SYMLINK_PATH,
				originalPath: null,
			},
		],
		...overrides,
	};
}

beforeEach(() => {
	vi.spyOn(process, "cwd").mockReturnValue("/");
});

afterEach(() => {
	resetMemfs();
	Caching.flushAllCaches();
	vi.restoreAllMocks();
});

it("should remove symlinks and delete the manifest", async () => {
	vol.fromJSON({
		[`${TARGET_DIR}/package.json`]: "{}",
		[`${REAL_DIR}/index.js`]: "",
		[`${TARGET_DIR}/${LINK_MANIFEST}`]: JSON.stringify(makeManifest()),
	});
	fs.mkdirSync(path.dirname(SYMLINK_PATH), { recursive: true });
	fs.symlinkSync(REAL_DIR, SYMLINK_PATH, "dir");

	const unlink = new Unlink();
	const response = await unlink.run({ targetDir: TARGET_DIR });

	expect(response.succeeded).toBe(true);
	expect(() => fs.lstatSync(SYMLINK_PATH)).toThrow();
	expect(() => fs.statSync(path.join(TARGET_DIR, LINK_MANIFEST))).toThrow();
});

it("should restore an original real directory that was backed up", async () => {
	const backupPath = `${SYMLINK_PATH}.__forge_backup__`;
	vol.fromJSON({
		[`${TARGET_DIR}/package.json`]: "{}",
		[`${REAL_DIR}/index.js`]: "",
		[`${backupPath}/index.js`]: "original",
		[`${TARGET_DIR}/${LINK_MANIFEST}`]: JSON.stringify(
			makeManifest({
				links: [
					{ packageName: "@mock/app", symlinkPath: SYMLINK_PATH, originalPath: backupPath },
				],
			}),
		),
	});
	fs.mkdirSync(path.dirname(SYMLINK_PATH), { recursive: true });
	fs.symlinkSync(REAL_DIR, SYMLINK_PATH, "dir");

	const unlink = new Unlink();
	await unlink.run({ targetDir: TARGET_DIR });

	const stat = fs.statSync(SYMLINK_PATH);
	expect(stat.isDirectory()).toBe(true);
	expect(() => fs.statSync(backupPath)).toThrow();
});

it("should throw when no manifest exists", async () => {
	vol.fromJSON({ [`${TARGET_DIR}/package.json`]: "{}" });

	const unlink = new Unlink();
	await expect(unlink.run({ targetDir: TARGET_DIR })).rejects.toThrow(
		"No link manifest found",
	);
});

it("should restore an original pnpm symlink when originalPath is a relative symlink target", async () => {
	// pnpm stores packages as symlinks into .pnpm/ using relative paths
	const pnpmRelativeTarget = "../.pnpm/@mock+app@1.0.0/node_modules/@mock/app";
	const pnpmAbsoluteTarget = path.resolve(path.dirname(SYMLINK_PATH), pnpmRelativeTarget);

	vol.fromJSON({
		[`${TARGET_DIR}/package.json`]: "{}",
		[`${REAL_DIR}/index.js`]: "",
		[`${pnpmAbsoluteTarget}/index.js`]: "pnpm original",
		[`${TARGET_DIR}/${LINK_MANIFEST}`]: JSON.stringify(
			makeManifest({
				links: [
					{
						packageName: "@mock/app",
						symlinkPath: SYMLINK_PATH,
						originalPath: pnpmRelativeTarget,
					},
				],
			}),
		),
	});
	fs.mkdirSync(path.dirname(SYMLINK_PATH), { recursive: true });
	fs.symlinkSync(REAL_DIR, SYMLINK_PATH, "dir");

	const unlink = new Unlink();
	await unlink.run({ targetDir: TARGET_DIR });

	const stat = fs.lstatSync(SYMLINK_PATH);
	expect(stat.isSymbolicLink()).toBe(true);
	expect(fs.readlinkSync(SYMLINK_PATH)).toBe(pnpmRelativeTarget);
});
