import { describe, expect, it } from "vitest";
import { TestedBuildError } from "./tested-build.error.mjs";
import { TestedBuild } from "./tested-build.service.mjs";

const SHA = "0123abcd";
const REPO = "typesmiths/decohere";

type Run = { id: number; status: string; conclusion: string | null; event: string };

function run(id: number, event: string, status = "completed", conclusion = "success"): Run {
	return { id, event, status, conclusion: status === "completed" ? conclusion : null };
}

/** A GitHub API that answers from `runs` (newest first, as GitHub lists them) and `artifacts`. */
function github(options: {
	runs: Run[] | (() => Run[]);
	artifacts?: Record<number, { name: string; expired: boolean }[]>;
}) {
	const asked: string[] = [];
	const api = async (path: string) => {
		asked.push(path);
		const runsPath = new RegExp(
			`^repos/${REPO}/actions/workflows/ci\\.yml/runs\\?head_sha=${SHA}&event=([a-z_]+)&per_page=100$`,
		).exec(path);
		if (runsPath != null) {
			const all = typeof options.runs === "function" ? options.runs() : options.runs;
			const workflow_runs = all
				.filter((candidate) => candidate.event === runsPath[1])
				.map((candidate) => ({
					...candidate,
					head_sha: SHA,
					html_url: `https://github.com/${REPO}/actions/runs/${candidate.id}`,
				}));
			return { total_count: workflow_runs.length, workflow_runs };
		}
		const artifactsPath = new RegExp(
			`^repos/${REPO}/actions/runs/(\\d+)/artifacts\\?name=forge-release-beta-(\\d+)$`,
		).exec(path);
		if (artifactsPath != null) {
			const id = Number(artifactsPath[1]);
			const artifacts = (
				options.artifacts?.[id] ?? [{ name: `forge-release-beta-${id}`, expired: false }]
			).filter((artifact) => artifact.name === `forge-release-beta-${artifactsPath[2]}`);
			return { total_count: artifacts.length, artifacts };
		}
		throw new Error(`Unexpected API call: ${path}`);
	};
	return { api, asked };
}

/** A clock that moves only when the service waits. */
function clock() {
	let time = 0;
	const waits: number[] = [];
	return {
		now: () => time,
		wait: async (ms: number) => {
			waits.push(ms);
			time += ms;
		},
		waits,
	};
}

function service(api: (path: string) => Promise<unknown>, time = clock()) {
	const logged: string[] = [];
	const build = new TestedBuild({
		repo: REPO,
		api,
		now: time.now,
		wait: time.wait,
		log: (message: string) => logged.push(message),
		patienceMs: 60_000,
		pollMs: 15_000,
	});
	return { build, logged, time };
}

describe("TestedBuild", () => {
	it("takes the merge queue run that passed for the commit", async () => {
		const { api } = github({ runs: [run(12, "merge_group")] });
		const { build } = service(api);

		await expect(build.find(SHA, ["merge_group"])).resolves.toEqual({
			runId: 12,
			event: "merge_group",
			url: `https://github.com/${REPO}/actions/runs/12`,
		});
	});

	it("passes over a failed run for one that passed", async () => {
		const { api } = github({
			runs: [run(13, "merge_group", "completed", "failure"), run(12, "merge_group")],
		});
		const { build } = service(api);

		await expect(build.find(SHA, ["merge_group"])).resolves.toMatchObject({ runId: 12 });
	});

	it("ignores runs from other events: a push run on main isn't the queue's", async () => {
		const { api } = github({ runs: [run(20, "push")] });
		const { build } = service(api);

		await expect(build.find(SHA, ["merge_group"])).rejects.toThrow(TestedBuildError);
	});

	it("tries the events in order, so a version from before the queue built still releases", async () => {
		const { api, asked } = github({ runs: [run(20, "push")] });
		const { build } = service(api);

		await expect(build.find(SHA, ["merge_group", "push"])).resolves.toMatchObject({
			runId: 20,
			event: "push",
		});
		expect(asked[0]).toContain("event=merge_group");
	});

	it("waits for a run still finishing: the queue merges once `ci` passes, before the run ends", async () => {
		let calls = 0;
		const { api } = github({
			runs: () =>
				++calls < 3 ? [run(12, "merge_group", "in_progress")] : [run(12, "merge_group")],
		});
		const { build, logged, time } = service(api);

		await expect(build.find(SHA, ["merge_group"])).resolves.toMatchObject({ runId: 12 });
		expect(time.waits).toEqual([15_000, 15_000]);
		expect(logged.join("\n")).toContain("Waiting for");
	});

	it("refuses a commit the queue never tested, and says how that happens", async () => {
		const { api } = github({ runs: [] });
		const { build } = service(api);

		const error = await build.find(SHA, ["merge_group"]).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(TestedBuildError);
		expect((error as Error).message).toContain(
			`No CI run in the merge queue passed for ${SHA}`,
		);
		expect((error as Error).message).toContain("bypass");
		expect((error as Error).message).toContain("Nothing was published");
	});

	it("names the runs that failed", async () => {
		const { api } = github({ runs: [run(13, "merge_group", "completed", "failure")] });
		const { build } = service(api);

		await expect(build.find(SHA, ["merge_group"])).rejects.toThrow(
			`https://github.com/${REPO}/actions/runs/13 (failure)`,
		);
	});

	it("gives up on a run that doesn't finish in time", async () => {
		const { api } = github({ runs: [run(12, "merge_group", "in_progress")] });
		const { build, time } = service(api);

		await expect(build.find(SHA, ["merge_group"])).rejects.toThrow("still running");
		expect(time.now()).toBeGreaterThanOrEqual(60_000);
	});

	it("refuses a passed run whose build has expired", async () => {
		const { api } = github({
			runs: [run(12, "merge_group")],
			artifacts: { 12: [{ name: "forge-release-beta-12", expired: true }] },
		});
		const { build } = service(api);

		await expect(build.find(SHA, ["merge_group"])).rejects.toThrow(
			"its build forge-release-beta-12 has expired",
		);
	});

	it("refuses a passed run with no build", async () => {
		const { api } = github({ runs: [run(12, "merge_group")], artifacts: { 12: [] } });
		const { build } = service(api);

		await expect(build.find(SHA, ["merge_group"])).rejects.toThrow(
			"has no build forge-release-beta-12",
		);
	});
});
