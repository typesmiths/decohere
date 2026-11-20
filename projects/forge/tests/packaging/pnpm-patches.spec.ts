import fs from "node:fs";
import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { afterEach, describe, expect, it } from "vitest";
import { pnpmPatches } from "../../src/packaging/pnpm-patches.js";

const nodeModules = "/ws/out/node_modules";

const twoFiles = [
	"--- a/a.js",
	"+++ b/a.js",
	"@@ -1 +1 @@",
	"-a",
	"+A",
	"--- a/b.js",
	"+++ b/b.js",
	"@@ -1 +1 @@",
	"-b",
	"+B",
	"",
].join("\n");

function pkg(dir: string, name: string, version: string, files: Record<string, string>) {
	return {
		[`${dir}/package.json`]: JSON.stringify({ name, version }),
		...Object.fromEntries(
			Object.entries(files).map(([file, text]) => [`${dir}/${file}`, text]),
		),
	};
}

afterEach(() => {
	resetMemfs();
});

describe("pnpmPatches", () => {
	it("reads scoped names, with and without a version", async () => {
		vol.fromJSON({
			"/ws/package.json": JSON.stringify({
				pnpm: {
					patchedDependencies: {
						"@scope/lib@1.0.0-dev.3": "patches/a.patch",
						"@scope/other": "patches/b.patch",
					},
				},
			}),
		});

		const patches = await pnpmPatches.read("/ws");

		expect(patches).toEqual([
			expect.objectContaining({ name: "@scope/lib", spec: "1.0.0-dev.3", exact: true }),
			expect.objectContaining({ name: "@scope/other", spec: undefined, exact: false }),
		]);
	});

	it("refuses one key set to two different files", async () => {
		vol.fromJSON({
			"/ws/package.json": JSON.stringify({
				pnpm: { patchedDependencies: { "ms@2.1.3": "patches/a.patch" } },
			}),
			"/ws/pnpm-workspace.yaml": "patchedDependencies:\n  ms@2.1.3: patches/b.patch\n",
		});

		await expect(pnpmPatches.read("/ws")).rejects.toThrow("set twice");
	});

	it("patches a scoped package and a copy nested under another package", async () => {
		vol.fromJSON({
			"/ws/patches/lib.patch": twoFiles,
			...pkg(`${nodeModules}/@scope/lib`, "@scope/lib", "1.0.0", {
				"a.js": "a\n",
				"b.js": "b\n",
			}),
			...pkg(`${nodeModules}/host/node_modules/@scope/lib`, "@scope/lib", "1.0.0", {
				"a.js": "a\n",
				"b.js": "b\n",
			}),
			...pkg(`${nodeModules}/host`, "host", "3.0.0", {}),
		});
		const patches = [
			{
				key: "@scope/lib",
				name: "@scope/lib",
				spec: undefined,
				exact: false,
				file: "patches/lib.patch",
			},
		];

		const report = await pnpmPatches.apply(patches, "/ws", "/ws/out", "@app/api");

		expect(report.applied).toHaveLength(2);
		expect(fs.readFileSync(`${nodeModules}/@scope/lib/b.js`, "utf8")).toBe("B\n");
		expect(fs.readFileSync(`${nodeModules}/host/node_modules/@scope/lib/b.js`, "utf8")).toBe(
			"B\n",
		);
	});

	it("prefers the exact key over a range over the bare name", async () => {
		vol.fromJSON({
			"/ws/patches/exact.patch": twoFiles,
			"/ws/patches/bare.patch": "--- a/a.js\n+++ b/a.js\n@@ -1 +1 @@\n-a\n+bare\n",
			...pkg(`${nodeModules}/lib`, "lib", "1.0.0", { "a.js": "a\n", "b.js": "b\n" }),
		});
		const patches = [
			{ key: "lib", name: "lib", spec: undefined, exact: false, file: "patches/bare.patch" },
			{
				key: "lib@1.0.0",
				name: "lib",
				spec: "1.0.0",
				exact: true,
				file: "patches/exact.patch",
			},
		];

		await pnpmPatches.apply(patches, "/ws", "/ws/out", "@app/api");

		expect(fs.readFileSync(`${nodeModules}/lib/a.js`, "utf8")).toBe("A\n");
	});

	it("writes nothing when a later file of the patch doesn't apply", async () => {
		vol.fromJSON({
			"/ws/patches/lib.patch": twoFiles,
			...pkg(`${nodeModules}/lib`, "lib", "1.0.0", { "a.js": "a\n", "b.js": "changed\n" }),
		});
		const patches = [
			{ key: "lib", name: "lib", spec: undefined, exact: false, file: "patches/lib.patch" },
		];

		await expect(pnpmPatches.apply(patches, "/ws", "/ws/out", "@app/api")).rejects.toThrow(
			"patches/lib.patch doesn't apply to lib@1.0.0: b.js",
		);
		expect(fs.readFileSync(`${nodeModules}/lib/a.js`, "utf8")).toBe("a\n");
	});

	it("refuses a patch that reaches outside its package", async () => {
		vol.fromJSON({
			"/ws/patches/lib.patch": "--- a/../x.js\n+++ b/../x.js\n@@ -0,0 +1 @@\n+x\n",
			...pkg(`${nodeModules}/lib`, "lib", "1.0.0", {}),
		});
		const patches = [
			{ key: "lib", name: "lib", spec: undefined, exact: false, file: "patches/lib.patch" },
		];

		await expect(pnpmPatches.apply(patches, "/ws", "/ws/out", "@app/api")).rejects.toThrow(
			"outside lib",
		);
	});
});
