import { describe, expect, it } from "vitest";
import {
	buildDescription,
	extractGitHubReviewerLogins,
	firstPublishCommands,
	issueTitle,
	needsPrereleaseTag,
	parseUnpublished,
	runNudge,
} from "../../src/github/oidc-bootstrap-nudge.mjs";

describe("oidc-bootstrap-nudge", () => {
	it("parses unpublished names", () => {
		expect(parseUnpublished(" @decohere/scaffold  @decohere/cli ")).toEqual([
			"@decohere/scaffold",
			"@decohere/cli",
		]);
		expect(issueTitle()).toBe("deploy(publish): OIDC bootstrap unpublished packages");
	});

	it("extracts GitHub user reviewers and skips teams", () => {
		expect(
			extractGitHubReviewerLogins({
				protection_rules: [
					{ type: "branch_policy", reviewers: [] },
					{
						type: "required_reviewers",
						reviewers: [
							{ type: "User", reviewer: { login: "das974" } },
							{ type: "Team", reviewer: { slug: "publishers", login: "should-skip" } },
						],
					},
				],
			}),
		).toEqual(["das974"]);
	});

	it("puts first-publish commands and Trusted Publisher fields in the task body", () => {
		const pkg = { name: "@decohere/scaffold", dir: "scaffold", version: "0.0.1-dev.18" };
		const body = buildDescription({
			unpublished: ["@decohere/scaffold"],
			packages: [pkg],
			repo: "typesmiths/decohere",
			runUrl: "https://github.com/typesmiths/decohere/actions/runs/9",
			channel: "dev",
		});
		expect(needsPrereleaseTag("0.0.1-dev.18")).toBe(true);
		expect(needsPrereleaseTag("1.2.3")).toBe(false);
		expect(firstPublishCommands([pkg], "dev")).toEqual([
			"npm publish ./projects/scaffold --access public --tag dev",
		]);
		expect(firstPublishCommands([{ ...pkg, version: "1.0.0" }], "dev")).toEqual([
			"npm publish ./projects/scaffold --access public",
		]);
		expect(body).toContain("npm publish ./projects/scaffold --access public --tag dev");
		expect(body).toContain("pnpm npm:bootstrap --otp <code> @decohere/scaffold");
		expect(body).not.toMatch(/# @decohere\/scaffold/);
		expect(body).toContain("First-publish each name **public**");
		expect(body).toContain("Workflow filename: `publish.yml`");
		expect(body).toContain("Environment: `npm-publish`");
		expect(body).toContain("gh run rerun --failed");
		expect(body).toContain("https://github.com/typesmiths/decohere/actions/runs/9");
	});

	it("assigns the bootstrap environment's reviewers to the issue", async () => {
		/** @type {object[]} */
		const upserts = [];
		const code = await runNudge(
			{ UNPUBLISHED: "@decohere/scaffold", GITHUB_REPOSITORY: "typesmiths/decohere" },
			{
				listPackages: () => [{ name: "@decohere/scaffold", dir: "scaffold" }],
				githubReviewers: async () => ["das974"],
				upsert: (options) => {
					upserts.push(options);
					return {
						number: 5,
						url: "https://github.com/typesmiths/decohere/issues/5",
						created: true,
					};
				},
				runUrl: "https://github.com/typesmiths/decohere/actions/runs/1",
			},
		);
		expect(code).toBe(0);
		expect(upserts[0].title).toBe(issueTitle());
		expect(upserts[0].assignees).toEqual(["das974"]);
		expect(upserts[0].body).toContain("`@decohere/scaffold`");
	});
});
