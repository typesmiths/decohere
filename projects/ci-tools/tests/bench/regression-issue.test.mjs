import { describe, expect, it } from "vitest";
import { issueBody, issueTitle } from "../../src/bench/regression-issue.mjs";

const regression = {
	id: "flux.load.cold",
	label: "flux load, first import (cold process)",
	base: 300,
	head: 400,
	percent: 33.3,
	rounds: [
		{ base: 300, head: 395 },
		{ base: 300, head: 405 },
	],
};
const context = {
	repoUrl: "https://github.com/typesmiths/decohere",
	runUrl: "https://github.com/typesmiths/decohere/actions/runs/1",
	machine: "gh-actions-node24, Test CPU × 4",
	threshold: 0.2,
	base: "aaaaaaaaaaaaaaaa",
	head: "cccccccccccccccc",
};

describe("regression issue", () => {
	it("has one stable title per benchmark, so the nightly run finds and updates it", () => {
		expect(issueTitle(regression)).toBe("perf(bench): flux.load.cold is slower");
	});

	it("gives both rounds, the commit range and how to reproduce", () => {
		const body = issueBody(regression, context);
		expect(body).toContain(
			"is 33% slower on [`ccccccc`](https://github.com/typesmiths/decohere/commit/cccccccccccccccc)",
		);
		expect(body).toContain("| 1 | 300.0 ms | 395.0 ms |");
		expect(body).toContain("| 2 | 300.0 ms | 405.0 ms |");
		expect(body).toContain(
			"(https://github.com/typesmiths/decohere/compare/aaaaaaaaaaaaaaaa...cccccccccccccccc)",
		);
		expect(body).toContain("check out `aaaaaaa`, run `pnpm bench:save`");
		expect(body).toContain(context.runUrl);
	});
});
