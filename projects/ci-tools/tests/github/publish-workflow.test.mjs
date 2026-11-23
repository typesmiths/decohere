import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const fs = await vi.importActual("node:fs");
const PUBLISH_YML = fileURLToPath(
	new URL("../../../../.github/workflows/publish.yml", import.meta.url),
);

describe("publish.yml", () => {
	const yml = fs.readFileSync(PUBLISH_YML, "utf8");

	it("defaults a stable release to a dry run", () => {
		const dryRun = yml.slice(yml.indexOf("dry_run:"), yml.indexOf("\nconcurrency:"));

		expect(dryRun).toMatch(/default: true/);
	});

	it("stops a stable release before publishing on a dry run, or if its checks fail", () => {
		const verify = yml.slice(yml.indexOf("\n  verify:"), yml.indexOf("\n  npm:"));

		expect(verify).toContain("inputs.dry_run != true");
		expect(verify).toContain("needs.release-build.result == 'success'");
	});

	it("ships a stable release from the tested build, without rebuilding it", () => {
		const build = yml.slice(yml.indexOf("\n  release-build:"), yml.indexOf("\n  verify:"));

		expect(build).toContain("forge-release-beta-");
		expect(build).toContain("restamp-build.mjs");
		expect(build).not.toContain("forge --log-level info build");
	});

	it("takes either a tested version or a patch branch, and checks a patch before using it", () => {
		const inputs = yml.slice(yml.indexOf("workflow_dispatch:"), yml.indexOf("\nconcurrency:"));
		const guard = yml.slice(yml.indexOf("\n  guard:"), yml.indexOf("\n  release-build:"));

		expect(inputs).toContain("patch_branch:");
		expect(guard).toContain("check-patch-release.mjs");
		expect(guard).toContain("Give either tested_version or patch_branch");
	});

	it("looks for code changes since the last shipped commit, not the parent", () => {
		const guard = yml.slice(yml.indexOf("\n  guard:"), yml.indexOf("\n  release-build:"));

		expect(guard).toContain("find-publish-base.mjs");
		expect(guard).toContain("fetch-depth: 0");
		expect(guard).not.toContain("HEAD^1");
	});

	it("only releases a patch whose commit passed full CI on its branch", () => {
		const guard = yml.slice(yml.indexOf("\n  guard:"), yml.indexOf("\n  release-build:"));
		const find = guard.indexOf('tested-build.command.mjs "$sha" "$events"');

		expect(find).toBeGreaterThan(-1);
		expect(guard).toMatch(/if \[\[ -n "\$PATCH_BRANCH" \]\]; then\n\s+events=push\n/);
		expect(guard.indexOf("git/ref/heads/")).toBeLessThan(find);
	});

	it("releases a tested version from the queue's build, or main's for a version from before", () => {
		const guard = yml.slice(yml.indexOf("\n  guard:"), yml.indexOf("\n  release-build:"));

		expect(guard).toMatch(/else\n\s+events=merge_group,push\n/);
	});

	it("starts on a push to main, not when a CI run finishes", () => {
		const on = yml.slice(0, yml.indexOf("workflow_dispatch:"));

		expect(on).toMatch(/push:\n\s+branches: \[main\]/);
		expect(yml).not.toContain("workflow_run");
	});

	it("ships the build the merge queue tested for this same commit", () => {
		const guard = yml.slice(yml.indexOf("\n  guard:"), yml.indexOf("\n  release-build:"));
		const queue = guard.slice(guard.indexOf("- name: Find the merge queue's build"));

		expect(queue).toContain("if: steps.check.outputs.should_publish == 'true'");
		expect(queue).toContain('tested-build.command.mjs "$SHA" merge_group');
		expect(guard).toContain(
			"build_run_id: ${{ steps.release.outputs.build_run_id || steps.queue.outputs.run_id }}",
		);
	});

	it("gives the guard longer than the wait for a queue run that's still finishing", () => {
		const guard = yml.slice(yml.indexOf("\n  guard:"), yml.indexOf("\n  release-build:"));
		const minutes = Number(/timeout-minutes: (\d+)/.exec(guard)?.[1]);
		const service = fs.readFileSync(
			fileURLToPath(new URL("../../src/release/tested-build.service.mjs", import.meta.url)),
			"utf8",
		);
		const patience = Number(/patienceMs \?\? (\d+) \* 60_000/.exec(service)?.[1]);

		expect(patience).toBeGreaterThan(0);
		expect(minutes).toBeGreaterThan(patience);
	});

	it("refuses a commit with no tested build rather than building one", () => {
		const queue = yml.slice(yml.indexOf("- name: Find the merge queue's build"));

		expect(queue.slice(0, queue.indexOf("\n      - "))).not.toContain("continue-on-error");
		// Only CI stamps and builds. A stable release only changes the version of a tested build.
		expect(yml).not.toMatch(/forge [^\n]*\bbuild --configuration/);
		expect(yml).not.toMatch(/forge [^\n]*\bversion --channel/);
	});

	it("reads a patch's tested version from its build", () => {
		const build = yml.slice(yml.indexOf("\n  release-build:"), yml.indexOf("\n  verify:"));

		expect(build).toContain("dist/release/projects/cli/package.json");
	});

	it("never lowers main's base version after a patch", () => {
		const finish = yml.slice(
			yml.indexOf("\n  release-finish:"),
			yml.indexOf("\n  failure-report:"),
		);

		expect(finish).toContain("sort -V");
	});

	it("doesn't publish a patch branch by itself: only main publishes automatically", () => {
		const on = yml.slice(0, yml.indexOf("workflow_dispatch:"));
		const guard = yml.slice(yml.indexOf("\n  guard:"), yml.indexOf("\n  release-build:"));

		expect(on).toContain("branches: [main]");
		expect(guard).toContain("github.ref == 'refs/heads/main'");
	});

	it("only tags a version once npm and the images have shipped", () => {
		const tag = yml.slice(yml.indexOf("\n  tag:"));
		const needs = /needs: \[(.+)\]/.exec(tag)?.[1].split(", ");

		expect(needs).toContain("npm");
		expect(needs).toContain("check-images");
	});

	it("checks the images with no login, as a stranger would", () => {
		const job = yml.slice(yml.indexOf("\n  check-images:"), yml.indexOf("\n  tag:"));

		expect(job).toContain("permissions: {}");
		expect(job).toContain("docker manifest inspect");
		expect(job).not.toContain("docker login");
	});

	it("reads npm without a token: the packages are public and publishing is OIDC", () => {
		const workflows = fileURLToPath(new URL("../../../../.github/", import.meta.url));
		const files = fs
			.readdirSync(workflows, { recursive: true })
			.filter((file) => /\.ya?ml$/.test(file));
		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			expect(fs.readFileSync(`${workflows}${file}`, "utf8"), file).not.toMatch(
				/NODE_AUTH_TOKEN|_authToken/,
			);
		}
	});

	it("grants the tag job actions:read so publish-prepare can download CI artifacts", () => {
		const tag = yml.slice(yml.indexOf("\n  tag:"));
		const perms = tag.slice(tag.indexOf("permissions:"), tag.indexOf("steps:"));
		expect(perms).toMatch(/contents:\s*write/);
		expect(perms).toMatch(/actions:\s*read/);
	});
});
