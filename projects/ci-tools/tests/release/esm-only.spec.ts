import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { join } = await vi.importActual<typeof import("node:path")>("node:path");
const { execFileSync } =
	await vi.importActual<typeof import("node:child_process")>("node:child_process");

const repo = fileURLToPath(new URL("../../../../", import.meta.url));

function publishedManifests() {
	return execFileSync(
		"git",
		["ls-files", "projects/**/package.json", "projects/*/package.json"],
		{
			cwd: repo,
			encoding: "utf8",
		},
	)
		.split("\n")
		.filter((file) => file !== "" && !file.includes("__fixtures__"))
		.map((file) => ({ file, manifest: JSON.parse(fs.readFileSync(join(repo, file), "utf8")) }))
		.filter(({ manifest }) => manifest.private !== true && typeof manifest.name === "string");
}

// Packages used to offer a CommonJS entry that crashed when loaded.
describe("published packages are ESM only", () => {
	it("finds the packages", () => {
		expect(publishedManifests().length).toBeGreaterThan(10);
	});

	it.each(publishedManifests().map(({ file, manifest }) => [file, manifest]))(
		"%s offers no CommonJS entry",
		(_file, manifest) => {
			expect(JSON.stringify(manifest.exports ?? {})).not.toContain("commonjs");
			expect(JSON.stringify(manifest.exports ?? {})).not.toContain('"require"');
			expect(manifest.main ?? "").not.toContain("commonjs");
		},
	);
});
