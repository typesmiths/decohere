import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { vol } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listPublishablePackages } from "../../src/github/publish-verify.mjs";

const fs = await vi.importActual("node:fs");
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const REPO = "https://github.com/typesmiths/decohere";

/** The repo's real package.json files, loaded into the in-memory fs the tests run on. */
function loadRealManifests() {
	/** @type {Record<string, string>} */
	const files = {};
	const walk = (dir) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory() && !["node_modules", "dist"].includes(entry.name)) {
				walk(path);
			} else if (entry.name === "package.json") {
				files[join("/repo", relative(REPO_ROOT, path))] = fs.readFileSync(path, "utf8");
			}
		}
	};
	walk(join(REPO_ROOT, "projects"));
	return files;
}

afterEach(() => {
	vol.reset();
});

// npm shows these on each package's page, and Trusted Publishing's provenance is
// checked against `repository.url`, so a package without it fails to publish.
describe("published package metadata", () => {
	vol.fromJSON(loadRealManifests());
	const packages = listPublishablePackages("/repo").map((pkg) => ({
		...pkg,
		json: JSON.parse(String(vol.readFileSync(`/repo/projects/${pkg.dir}/package.json`))),
	}));
	vol.reset();

	it("finds the publishable packages", () => {
		expect(packages.length).toBeGreaterThan(0);
	});

	it.each(packages.map((pkg) => [pkg.name, pkg]))(
		"%s links back to the repo",
		(_name, pkg) => {
			expect(pkg.json.repository).toEqual({
				type: "git",
				url: `git+${REPO}.git`,
				directory: `projects/${pkg.dir}`,
			});
			expect(pkg.json.homepage).toBe(`${REPO}/tree/main/projects/${pkg.dir}#readme`);
			expect(pkg.json.bugs).toEqual({ url: `${REPO}/issues` });
		},
	);

	it.each(packages.map((pkg) => [pkg.name, pkg]))(
		"%s has a description, keywords, license and author",
		(_name, pkg) => {
			expect(pkg.json.description).toBeTruthy();
			expect(pkg.json.keywords?.length).toBeGreaterThan(0);
			expect(pkg.json.license).toBe("ISC");
			expect(pkg.json.author).toBeTruthy();
		},
	);
});
