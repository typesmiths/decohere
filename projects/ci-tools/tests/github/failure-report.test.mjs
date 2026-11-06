import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
	errorCommand,
	extractFailure,
	formatSummary,
} from "../../src/github/failure-report.mjs";

const fs = await vi.importActual("node:fs");
const WORKFLOWS = fileURLToPath(new URL("../../../../.github/workflows", import.meta.url));

const stamp = "2026-11-06T09:12:21.3065221Z ";
const log = (...lines) => lines.map((line) => `${stamp}${line}`).join("\n");

// Shape and text taken from a real failed Promote to latest run.
const PROMOTE = log(
	"##[group]Run npm install -g npm@12.2.2",
	"npm install -g npm@12.2.2",
	"##[endgroup]",
	"removed 8 packages, and changed 77 packages in 4s",
	"##[group]Run node projects/ci-tools/src/release/promote-latest.mjs",
	"node projects/ci-tools/src/release/promote-latest.mjs",
	"env:",
	"  PROMOTE_VERSION: 0.0.1-dev.20261105.119",
	"##[endgroup]",
	"Promoting 0.0.1-dev.20261105.119 to latest on 18 packages",
	"0.0.1-dev.20261105.119 is 12.8 hours old. Wait, or run with allow_young. Nothing moved.",
	"##[error]Process completed with exit code 1.",
	"Post job cleanup.",
	"[command]/usr/bin/git version",
	"##[warning]Node.js 20 is deprecated.",
);

// Shape and text taken from a real failed test shard, colours included.
const TESTS = log(
	"##[group]Run pnpm test --shard=2/3",
	"pnpm test --shard=2/3",
	"##[endgroup]",
	"\u001b[33m✓\u001b[39m flux serve > keeps running",
	"##[error]Error: forge build failed:",
	"\u001b[2m Test Files \u001b[22m \u001b[31m1 failed\u001b[39m | 65 passed (66)",
	" ELIFECYCLE  Test failed. See above for more details.",
	"##[error]Process completed with exit code 1.",
	"Post job cleanup.",
	"##[start-action display=Run actions/setup-node@v4;id=x]",
);

describe("extractFailure", () => {
	it("finds the reason a script printed before exiting", () => {
		const { reason, lines } = extractFailure(PROMOTE);

		expect(reason).toBe(
			"0.0.1-dev.20261105.119 is 12.8 hours old. Wait, or run with allow_young. Nothing moved.",
		);
		expect(lines).toContain("Promoting 0.0.1-dev.20261105.119 to latest on 18 packages");
	});

	it("keeps only the failed step, not earlier steps, its env block or the cleanup", () => {
		const { lines } = extractFailure(PROMOTE);
		const text = lines.join("\n");

		expect(text).not.toContain("removed 8 packages");
		expect(text).not.toContain("PROMOTE_VERSION");
		expect(text).not.toContain("Post job cleanup");
		expect(text).not.toContain("Process completed");
	});

	it("prefers an error the tool marked over the last line, and removes colours", () => {
		const { reason, lines } = extractFailure(TESTS);

		expect(reason).toBe("Error: forge build failed:");
		expect(lines).toContain(" Test Files  1 failed | 65 passed (66)");
		expect(lines.join("\n")).not.toContain("\u001b");
		expect(lines.join("\n")).not.toContain("##[");
	});

	it("skips package manager noise when choosing the last line", () => {
		const { reason } = extractFailure(
			log(
				"##[group]Run pnpm build",
				"##[endgroup]",
				"TS2307: Cannot find module",
				" ELIFECYCLE  Command failed with exit code 2.",
				"npm error A complete log of this run can be found in: /tmp/x.log",
				"##[error]Process completed with exit code 2.",
			),
		);

		expect(reason).toBe("TS2307: Cannot find module");
	});

	it("finds the error above a stack trace (real Docker failure)", () => {
		const { reason } = extractFailure(
			log(
				"##[group]Run forge docker",
				"##[endgroup]",
				"#12 ERROR: process exited",
				"Dockerfile:27",
				"ERROR: failed to build: failed to solve: exit code: 1",
				"    at DockerCommand.run (command.ts:72:8)",
				"    }",
				"##[error]Process completed with exit code 1.",
			),
		);

		expect(reason).toBe("ERROR: failed to build: failed to solve: exit code: 1");
	});

	it("finds the error above the test totals (real unhandled Vitest error)", () => {
		const { reason } = extractFailure(
			log(
				"##[group]Run pnpm e2e",
				"##[endgroup]",
				'Error: [vitest-worker]: Timeout calling "onTaskUpdate"',
				" ❯ Object.onTimeoutError node_modules/vitest/rpc.js:53:10",
				" Test Files  1 passed (1)",
				"     Errors  1 error",
				"   Duration  90.38s (transform 73ms)",
				"##[error]Process completed with exit code 1.",
			),
		);

		expect(reason).toBe('Error: [vitest-worker]: Timeout calling "onTaskUpdate"');
	});

	it("finds the file and line above a code excerpt (real lint failure)", () => {
		const { reason } = extractFailure(
			log(
				"##[group]Run actionlint",
				"##[endgroup]",
				".github/workflows/publish.yml:415:9: shellcheck reported issue: SC2016",
				"    |",
				"415 |         run: |",
				"    |         ^~~~",
				"##[error]Process completed with exit code 1.",
			),
		);

		expect(reason).toBe(
			".github/workflows/publish.yml:415:9: shellcheck reported issue: SC2016",
		);
	});

	it("handles an action that failed with its own error and no exit code line", () => {
		const { reason } = extractFailure(
			log(
				"##[group]Run actions/upload-artifact@v4",
				"##[endgroup]",
				"##[error]No files found",
			),
		);

		expect(reason).toBe("No files found");
	});

	it("keeps the last lines of a long log", () => {
		const many = Array.from({ length: 100 }, (_, index) => `line ${index}`);
		const { lines } = extractFailure(
			log(
				"##[group]Run x",
				"##[endgroup]",
				...many,
				"##[error]Process completed with exit code 1.",
			),
		);

		expect(lines).toHaveLength(40);
		expect(lines.at(-1)).toBe("line 99");
	});

	it("says so when a log has nothing to go on", () => {
		expect(extractFailure("").reason).toBe("No reason found in the log.");
	});
});

describe("errorCommand", () => {
	it("encodes text so a log line can't act as a workflow command", () => {
		const command = errorCommand("a, b: c", "bad\n::set-env name=X::1 100%");

		expect(command).toBe("::error title=a%2C b%3A c::bad%0A::set-env name=X::1 100%25");
		expect(command.split("\n")).toHaveLength(1);
	});

	it("shortens a very long reason", () => {
		expect(errorCommand("job", "x".repeat(5000)).length).toBeLessThan(1100);
	});
});

describe("formatSummary", () => {
	const failure = {
		job: "promote",
		step: "Move latest",
		url: "https://x/1",
		reason: "Too new",
	};

	it("names the job and step, gives the reason and links the log", () => {
		const summary = formatSummary([{ ...failure, lines: ["a", "b"] }]);

		expect(summary).toContain("### promote / Move latest");
		expect(summary).toContain("Too new");
		expect(summary).toContain("https://x/1");
		expect(summary).toContain("a\nb");
	});

	it("uses a code fence the log can't close", () => {
		const summary = formatSummary([{ ...failure, lines: ["```", "pretend heading"] }]);

		expect(summary).toContain("````\n```\npretend heading\n````");
	});
});

describe("every workflow reports its failures", () => {
	const workflows = fs.readdirSync(WORKFLOWS).filter((name) => name.endsWith(".yml"));

	it.each(workflows.filter((name) => name !== "ci.yml"))(
		"%s has a failure-report job that waits for every other job",
		(name) => {
			const yml = fs.readFileSync(`${WORKFLOWS}/${name}`, "utf8");
			const jobs = yml.slice(yml.indexOf("\njobs:"));
			const names = [...jobs.matchAll(/^ {2}([a-zA-Z0-9_-]+):$/gm)].map((match) => match[1]);
			const needs = /^ {2}failure-report:\n {4}needs: \[(.+)\]$/m.exec(jobs)?.[1].split(", ");

			expect(needs?.toSorted()).toEqual(
				names.filter((job) => job !== "failure-report").toSorted(),
			);
			expect(jobs).toContain("uses: ./.github/actions/failure-report");
		},
	);

	it("ci.yml reports from its required job, without changing that job's result", () => {
		const yml = fs.readFileSync(`${WORKFLOWS}/ci.yml`, "utf8");
		const ci = yml.slice(yml.indexOf("\n  ci:\n"));

		expect(ci).toMatch(
			/uses: \.\/\.github\/actions\/failure-report\n\s+if: contains\(needs\.\*\.result, 'failure'\)\n\s+continue-on-error: true/,
		);
		expect(ci).toContain("actions: read");
	});
});
