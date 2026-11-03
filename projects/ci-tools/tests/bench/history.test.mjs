import { describe, expect, it } from "vitest";
import {
	appendRun,
	assertValid,
	compare,
	contextId,
	compareRounds,
	latestRun,
	pruneStale,
	formatComparison,
	fromVitest,
	getContext,
	normalize,
	parseResults,
	previousRun,
	RESULT_PREFIX,
} from "../../src/bench/history.mjs";

const fakeOs = {
	cpus: () => [{ model: " Test CPU " }, { model: "Test CPU" }],
	platform: () => "linux",
	arch: () => "x64",
	totalmem: () => 16 * 1024 ** 3,
};
const ctx = getContext(
	fakeOs,
	{ BENCH_ENV: "gh-actions" },
	"v24.1.0",
	new Date("2026-10-20T03:17:00Z"),
);

const result = (id, median, extra = {}) => ({
	id,
	label: id,
	unit: "ms",
	median,
	p90: median * 1.2,
	min: median * 0.9,
	max: median * 1.3,
	samples: 5,
	...extra,
});

const vitestOutput = {
	files: [
		{
			groups: [
				{
					benchmarks: [
						{
							name: "forge build es6 + types (18 files)",
							mean: 70,
							median: 64,
							min: 60,
							max: 80,
							sampleCount: 5,
						},
						{
							name: "forge build es6 only (18 files)",
							mean: 10,
							min: 8,
							max: 12,
							sampleCount: 5,
						},
					],
				},
			],
		},
	],
};

describe("getContext / contextId", () => {
	it("describes the machine and names the CI environment with the Node major", () => {
		expect(ctx).toEqual({
			benchEnv: "gh-actions-node24",
			date: "2026-10-20T03:17:00.000Z",
			os: { platform: "linux", arch: "x64" },
			cpu: { model: "Test CPU", count: 2 },
			memoryGb: 16,
			node: "v24.1.0",
		});
		expect(getContext(fakeOs, {}, "v24.1.0").benchEnv).toBe("(local)");
	});

	it("gives the same id to the same machine regardless of date or env label", () => {
		const later = getContext(fakeOs, {}, "v24.1.0", new Date("2027-01-01"));
		expect(contextId(later)).toBe(contextId(ctx));
		expect(contextId({ ...ctx, cpu: { ...ctx.cpu, count: 4 } })).not.toBe(contextId(ctx));
	});
});

describe("parseResults", () => {
	it("reads the last result line among other output", () => {
		const results = [result("flux.load.cold", 250)];
		const output = `flux load: median 250 ms\n${RESULT_PREFIX}[]\n${RESULT_PREFIX}${JSON.stringify(results)}\n`;
		expect(parseResults(output, "flux-load")).toEqual(results);
	});

	it("fails, naming the suite, when there is no result line", () => {
		expect(() => parseResults("crashed\n", "flux-serve")).toThrow(/flux-serve/);
	});
});

describe("fromVitest", () => {
	it("maps forge benchmarks to stable ids, keeping the file count out of the label", () => {
		expect(fromVitest(vitestOutput)).toEqual([
			{
				id: "forge.build.local",
				label: "forge build es6 + types",
				unit: "ms",
				median: 64,
				min: 60,
				max: 80,
				samples: 5,
				files: 18,
			},
			// No median from vitest: the mean stands in.
			expect.objectContaining({ id: "forge.build.debug", median: 10, files: 18 }),
		]);
	});

	it("fails on a benchmark it has no id for, instead of charting it under a moving name", () => {
		const output = {
			files: [{ groups: [{ benchmarks: [{ name: "something new", mean: 1 }] }] }],
		};
		expect(() => fromVitest(output)).toThrow(/something new/);
	});
});

describe("assertValid", () => {
	it("passes real results and rejects NaN or empty ones, naming them", () => {
		expect(() => assertValid([result("a", 1)])).not.toThrow();
		expect(() =>
			assertValid([result("a", 1), result("b", Number.NaN), result("c", 2, { samples: 0 })]),
		).toThrow(/b, c/);
	});
});

describe("normalize", () => {
	it("keeps a version 2 history as it is", () => {
		const history = { version: 2, contexts: { x: { context: ctx, runs: [] } } };
		expect(normalize(history)).toBe(history);
	});

	it("converts version 1 forge runs so their trend carries on", () => {
		const v1 = {
			runs: {
				abc: {
					context: ctx,
					runs: [{ date: "2026-08-12T14:18:10Z", context: ctx, vitestOutput }],
				},
				empty: { context: ctx, runs: [] },
			},
		};
		const history = normalize(v1);
		expect(Object.keys(history.contexts)).toEqual(["abc"]);
		expect(history.contexts.abc.runs[0]).toMatchObject({
			date: "2026-08-12T14:18:10Z",
			sha: null,
			results: [{ id: "forge.build.local" }, { id: "forge.build.debug" }],
		});
	});

	it("starts empty when there is no history", () => {
		expect(normalize(null)).toEqual({ version: 2, contexts: {} });
	});
});

describe("appendRun / previousRun", () => {
	const run = (day) => ({
		date: `2026-10-${day}T03:17:00Z`,
		sha: `sha${day}`,
		results: [result("a", Number(day))],
	});

	it("puts the new run first, trims to the limit, and leaves the input untouched", () => {
		const empty = normalize(null);
		const one = appendRun(empty, ctx, run("18"), 2);
		const two = appendRun(one, ctx, run("19"), 2);
		const three = appendRun(two, ctx, run("20"), 2);

		expect(empty.contexts).toEqual({});
		expect(one.contexts[contextId(ctx)].runs).toHaveLength(1);
		expect(three.contexts[contextId(ctx)].runs.map((r) => r.sha)).toEqual(["sha20", "sha19"]);
		expect(previousRun(three, contextId(ctx))?.sha).toBe("sha20");
		expect(previousRun(three, "other-machine")).toBeUndefined();
	});
});

describe("compare / formatComparison", () => {
	it("reports the change in median against the previous run, and n/a for new benchmarks", () => {
		const rows = compare([result("a", 120), result("new", 5)], {
			results: [result("a", 100)],
		});
		expect(rows).toEqual([
			{ id: "a", current: 120, previous: 100, delta: 20, percent: 20 },
			{ id: "new", current: 5 },
		]);

		const table = formatComparison(rows).split("\n");
		expect(table[0]).toMatch(/^Benchmark \| +Median \| Previous \| +Delta \| +%$/);
		expect(table[2]).toMatch(/^a +\| +120\.0 ms \| +100\.0 ms \| +\+20\.0 ms \| \+20\.0%$/);
		expect(table[3]).toMatch(/^new +\| +5\.0 ms \| +n\/a \| +n\/a \| +n\/a$/);
	});

	it("compares against nothing on a machine's first run", () => {
		expect(compare([result("a", 1)], undefined)).toEqual([{ id: "a", current: 1 }]);
	});
});

describe("compareRounds", () => {
	const round = (...medians) => medians.map((median, index) => result(`b${index}`, median));

	it("flags a benchmark slower on head than base in every round, with both rounds' numbers", () => {
		const [regression] = compareRounds([round(130, 50)], [round(100, 50)], {
			threshold: 0.2,
			rounds: 1,
		});
		expect(regression).toMatchObject({
			id: "b0",
			base: 100,
			head: 130,
			rounds: [{ base: 100, head: 130 }],
		});
		expect(regression.percent).toBeCloseTo(30);
	});

	it("needs every round slower: one slow round is as likely the runner as the code", () => {
		expect(compareRounds([round(130), round(105)], [round(100), round(100)])).toEqual([]);
		expect(compareRounds([round(130), round(126)], [round(100), round(100)])).toHaveLength(1);
	});

	it("ignores slowdowns within the threshold", () => {
		expect(compareRounds([round(115), round(118)], [round(100), round(100)])).toEqual([]);
	});

	it("skips benchmarks only one side has, and compares nothing without enough rounds", () => {
		const head = [
			[result("new", 500), result("old", 100)],
			[result("new", 500), result("old", 100)],
		];
		const base = [[result("old", 100)], [result("old", 100)]];
		expect(compareRounds(head, base)).toEqual([]);
		expect(compareRounds([round(200)], [round(100)])).toEqual([]);
	});
});

describe("pruneStale / latestRun", () => {
	const at = (date, sha) => ({ date, sha, results: [] });
	const history = {
		version: 2,
		contexts: {
			old: { context: ctx, runs: [at("2026-08-12T03:17:00Z", "aaa")] },
			recent: {
				context: ctx,
				runs: [at("2026-10-20T03:17:00Z", "ccc"), at("2026-10-19T03:17:00Z", "bbb")],
			},
		},
	};

	it("drops machine types with no run in the last 30 days", () => {
		expect(
			Object.keys(pruneStale(history, new Date("2026-10-21T00:00:00Z")).contexts),
		).toEqual(["recent"]);
		expect(
			Object.keys(pruneStale(history, new Date("2026-09-01T00:00:00Z")).contexts),
		).toEqual(["old", "recent"]);
	});

	it("prunes when a run is appended", () => {
		const next = appendRun(history, ctx, at("2026-10-21T03:17:00Z", "ddd"));
		expect(Object.keys(next.contexts)).not.toContain("old");
	});

	it("finds the newest run on any machine: the commit the previous nightly measured", () => {
		expect(latestRun(history)?.sha).toBe("ccc");
		expect(latestRun({ version: 2, contexts: {} })).toBeUndefined();
	});
});
