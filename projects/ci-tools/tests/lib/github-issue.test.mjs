import { describe, expect, it } from "vitest";
import { pickIssue, upsertIssue } from "../../src/lib/github-issue.mjs";

const TITLE = "chore(security): rotate NODE_AUTH_TOKEN (expires 2026-11-19)";

/** A fake `gh` that answers `issue list` with `issues` and records every call. */
function fakeGh(issues) {
	/** @type {{ args: string[], input?: string }[]} */
	const calls = [];
	const run = (args, input) => {
		calls.push({ args, input });
		if (args[1] === "list") return JSON.stringify(issues);
		if (args[1] === "create") return "https://github.com/typesmiths/decohere/issues/42\n";
		return "";
	};
	return { run, calls };
}

describe("github-issue", () => {
	it("matches the exact title only and prefers an open issue", () => {
		const issues = [
			{ number: 1, title: TITLE, state: "CLOSED", url: "u1" },
			{ number: 2, title: `${TITLE} (old)`, state: "OPEN", url: "u2" },
			{ number: 3, title: TITLE, state: "OPEN", url: "u3" },
		];
		expect(pickIssue(issues, TITLE)?.number).toBe(3);
		expect(pickIssue(issues.slice(0, 2), TITLE)?.number).toBe(1);
		expect(pickIssue([], TITLE)).toBeNull();
	});

	// GitHub's search can't match `security(ci): …` unquoted, so the lookup found nothing
	// and a new issue was opened on every run.
	it("searches for the title as a quoted phrase", () => {
		const { run, calls } = fakeGh([]);
		upsertIssue({ title: "security(ci): npm audit vulnerabilities detected", body: "b" }, run);
		const args = calls[0].args;
		expect(args[args.indexOf("--search") + 1]).toBe(
			'"security(ci): npm audit vulnerabilities detected" in:title',
		);
	});

	it("opens an issue with assignees when none has the title", () => {
		const { run, calls } = fakeGh([]);
		const result = upsertIssue({ title: TITLE, body: "body", assignees: ["das974"] }, run);
		expect(result).toEqual({
			number: 42,
			url: "https://github.com/typesmiths/decohere/issues/42",
			created: true,
		});
		expect(calls[1]).toEqual({
			args: [
				"issue",
				"create",
				"--title",
				TITLE,
				"--body-file",
				"-",
				"--add-assignee",
				"das974",
			],
			input: "body",
		});
	});

	it("updates an open issue's body in place", () => {
		const { run, calls } = fakeGh([{ number: 7, title: TITLE, state: "OPEN", url: "u7" }]);
		const result = upsertIssue({ title: TITLE, body: "new body" }, run);
		expect(result).toEqual({ number: 7, url: "u7", created: false });
		expect(calls.map((call) => call.args[1])).toEqual(["list", "edit"]);
		expect(calls[1]).toEqual({
			args: ["issue", "edit", "7", "--body-file", "-"],
			input: "new body",
		});
	});

	it("reopens a closed issue before updating it", () => {
		const { run, calls } = fakeGh([{ number: 7, title: TITLE, state: "CLOSED", url: "u7" }]);
		upsertIssue({ title: TITLE, body: "b", repo: "typesmiths/decohere" }, run);
		expect(calls.map((call) => call.args.slice(0, 3))).toEqual([
			["issue", "list", "--repo"],
			["issue", "reopen", "7"],
			["issue", "edit", "7"],
		]);
	});
});
