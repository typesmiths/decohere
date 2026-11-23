import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const fs = await vi.importActual("node:fs");
const CI_YML = fileURLToPath(new URL("../../../../.github/workflows/ci.yml", import.meta.url));

describe("ci.yml and the merge queue", () => {
	const yml = fs.readFileSync(CI_YML, "utf8");
	const triggers = yml.slice(yml.indexOf("\non:"), yml.indexOf("\nconcurrency:"));
	const gate = yml.slice(yml.indexOf("- id: gate"), yml.indexOf("# Static gates"));
	const jobs = yml.slice(yml.indexOf("\njobs:"));
	/** A job's heading: its needs, `if` and outputs, up to its steps. */
	const heading = (job) => {
		const start = jobs.indexOf(`\n  ${job}:`);
		return jobs.slice(start, jobs.indexOf("steps:", start));
	};

	it("runs for queued pull requests, or the queue waits forever for the required check", () => {
		expect(triggers).toMatch(/^\s+merge_group:/m);
	});

	it("runs the whole suite in the queue: the docs-only shortcut is only for pull requests", () => {
		expect(gate).toContain('"${{ github.event_name }}" == "merge_group"');
	});

	it("runs nothing on a push to main: the queue tested that same commit, and Publish ships its build", () => {
		expect(triggers).toContain('branches: ["release/**"]');
		expect(triggers).not.toMatch(/branches: \[.*\bmain\b/);
		expect(jobs).not.toContain("refs/heads/main");
	});

	it("makes the full run in the queue, on a patch branch, and when started by hand", () => {
		const full = gate.slice(0, gate.indexOf('echo "full=true"'));
		expect(full).toContain('"${{ github.event_name }}" == "merge_group"');
		expect(full).toContain('"${{ github.event_name }}" == "workflow_dispatch"');
		expect(full).toContain("refs/heads/release/");
		expect(heading("changes")).toContain("full: ${{ steps.gate.outputs.full }}");
	});

	it("builds, verifies the release, and runs coverage and Docker tests in the full run", () => {
		for (const job of ["build", "verify-release", "coverage", "test-docker"]) {
			expect(heading(job), job).toContain("needs.changes.outputs.full == 'true'");
		}
	});

	it("runs the unit test shards only outside the full run, where coverage runs the same tests", () => {
		expect(heading("test")).toContain("needs.changes.outputs.full != 'true'");
	});

	it("makes the required check wait for every job, so a failing job can't be missed", () => {
		const names = [...jobs.matchAll(/^ {2}([a-z-]+):$/gm)].map((match) => match[1]);
		const needs = /^ {2}ci:\n {4}needs: \[(.+)\]$/m.exec(jobs)?.[1].split(", ");

		// `release` follows `ci`.
		expect(needs?.toSorted()).toEqual(
			names.filter((name) => name !== "ci" && name !== "release").toSorted(),
		);
	});
});

describe("the release build passed between jobs", () => {
	const workflows = ["ci.yml", "publish.yml"].map((name) => ({
		name,
		yml: fs.readFileSync(
			fileURLToPath(new URL(`../../../../.github/workflows/${name}`, import.meta.url)),
			"utf8",
		),
	}));

	// upload-artifact leaves hidden files out by default. The scaffolder's templates are mostly
	// dot-files (.devcontainer, .github, .vscode), so without them every new app would lack them,
	// and Publish ships what verify-release tested: the uploaded build.
	it("keeps its hidden files, such as the scaffolder's .devcontainer templates", () => {
		const uploads = workflows.flatMap(({ name, yml }) =>
			[...yml.matchAll(/uses: actions\/upload-artifact@\S+\n {8}with:\n((?: {10}.*\n)+)/g)]
				.map((match) => ({ name, step: match[1] }))
				.filter(({ step }) => /path: dist\/release\//.test(step)),
		);
		expect(uploads.map(({ name }) => name).toSorted()).toEqual(["ci.yml", "publish.yml"]);
		for (const { name, step } of uploads) {
			expect(step, name).toMatch(/include-hidden-files: true/);
		}
	});
});

describe("pages.yml", () => {
	const yml = fs.readFileSync(
		fileURLToPath(new URL("../../../../.github/workflows/pages.yml", import.meta.url)),
		"utf8",
	);
	const on = yml.slice(yml.indexOf("\non:"), yml.indexOf("\nconcurrency:"));

	it("deploys on a push to main, without waiting for a CI run there", () => {
		expect(on).toMatch(/push:\n\s+branches: \[main\]/);
		expect(yml).not.toContain("workflow_run");
	});

	it("takes the coverage the merge queue measured for that commit", () => {
		expect(yml).toContain('tested-build.command.mjs "$SHA" merge_group');
		const download = yml.slice(yml.indexOf("name: coverage-data"));
		expect(download.slice(0, download.indexOf("path:"))).toContain(
			"run-id: ${{ steps.tested.outputs.run_id }}",
		);
	});
});
