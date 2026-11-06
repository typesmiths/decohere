import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const fs = await vi.importActual("node:fs");
const CI_YML = fileURLToPath(new URL("../../../../.github/workflows/ci.yml", import.meta.url));

describe("ci.yml and the merge queue", () => {
	const yml = fs.readFileSync(CI_YML, "utf8");
	const triggers = yml.slice(yml.indexOf("\non:"), yml.indexOf("\nconcurrency:"));
	const gate = yml.slice(yml.indexOf("- id: gate"), yml.indexOf("# Static gates"));

	it("runs for queued pull requests, or the queue waits forever for the required check", () => {
		expect(triggers).toMatch(/^\s+merge_group:/m);
	});

	it("runs the whole suite in the queue: the docs-only shortcut is only for pull requests", () => {
		expect(gate).toContain('"${{ github.event_name }}" == "merge_group"');
	});

	it("runs the whole suite on a patch branch, whose commits weren't tested on main", () => {
		const jobs = yml.slice(yml.indexOf("\njobs:"));
		expect(triggers).toContain('branches: [main, "release/**"]');
		for (const job of ["coverage", "build", "verify-release"]) {
			const start = jobs.indexOf(`\n  ${job}:`);
			expect(jobs.slice(start, jobs.indexOf("runs-on:", start)), job).toContain(
				"startsWith(github.ref, 'refs/heads/release/')",
			);
		}
	});

	it("makes the required check wait for every job, so a failing job can't be missed", () => {
		const jobs = yml.slice(yml.indexOf("\njobs:"));
		const names = [...jobs.matchAll(/^ {2}([a-z-]+):$/gm)].map((match) => match[1]);
		const needs = /^ {2}ci:\n {4}needs: \[(.+)\]$/m.exec(jobs)?.[1].split(", ");

		// `release` follows `ci`.
		expect(needs?.toSorted()).toEqual(
			names.filter((name) => name !== "ci" && name !== "release").toSorted(),
		);
	});
});
