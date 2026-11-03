import { describe, expect, it } from "vitest";
import { buildBenchmarkHtml, trendSvg } from "../../src/pages/bench-page.mjs";

const context = (benchEnv, cores) => ({
	benchEnv,
	os: { platform: "linux", arch: "x64" },
	cpu: { model: "Test CPU", count: cores },
	memoryGb: 16,
	node: "v24.1.0",
});

const run = (date, sha, results) => ({ date, sha, results });
const result = (id, median, label = id) => ({
	id,
	label,
	unit: "ms",
	median,
	p90: median * 1.2,
	min: median,
	max: median,
	samples: 5,
});

const history = {
	version: 2,
	contexts: {
		ci: {
			context: context("gh-actions-node24", 4),
			runs: [
				run("2026-10-20T03:17:00Z", "bbbbbbbbbbbb", [
					result("flux.serve.start", 90, "spawn <to> ready"),
					result("forge.build.debug", 9),
				]),
				run("2026-10-19T03:17:00Z", "aaaaaaaaaaaa", [
					result("flux.serve.start", 100, "spawn <to> ready"),
				]),
			],
		},
		laptop: {
			context: context("(local)", 24),
			runs: [run("2026-10-01T10:00:00Z", "cccccccccccc", [result("flux.serve.start", 40)])],
		},
	},
};

describe("buildBenchmarkHtml", () => {
	it("explains an empty history instead of rendering empty charts", () => {
		const html = buildBenchmarkHtml({ version: 2, contexts: {} });
		expect(html).toContain("No benchmark history yet");
		expect(html).not.toContain("<svg");
	});

	it("draws one card per benchmark, grouped, with a line per machine that ran it", () => {
		const html = buildBenchmarkHtml(history, { branch: "main", sha: "0123456789abcdef" });

		expect(html.match(/<article class="card">/g)).toHaveLength(2);
		expect(html.indexOf("flux serve (real process)")).toBeLessThan(
			html.indexOf("<h2>forge build</h2>"),
		);
		const serveCard = html.slice(
			html.indexOf("<code>flux.serve.start</code>"),
			html.indexOf("<code>forge.build.debug</code>"),
		);
		expect(serveCard.match(/<polyline/g)).toHaveLength(2);
		expect(html).toContain("built from main @ <code>0123456789ab</code>");
	});

	it("shows the latest median and the change from the previous run on the newest machine", () => {
		const html = buildBenchmarkHtml(history);
		expect(html).toContain("<strong>90.0 ms</strong> median · p90 108 ms");
		expect(html).toContain('<span class="change better">10.0% faster</span>');
	});

	it("dates each result and links its commit, in the latest table and on each card", () => {
		const html = buildBenchmarkHtml(history);
		expect(html).toContain("<th>Run</th><th>Commit</th>");
		expect(html).toContain("<td>2026-10-20 03:17 UTC</td>");
		expect(html).toContain(
			'<a href="https://github.com/typesmiths/decohere/commit/bbbbbbbbbbbb"><code>bbbbbbb</code></a>',
		);
		expect(html).toContain('<p class="when">Last run 2026-10-20 03:17 UTC</p>');
	});

	it("leaves out machine types with no run in the 30 days before the newest run", () => {
		const html = buildBenchmarkHtml({
			version: 2,
			contexts: {
				...history.contexts,
				gone: {
					context: context("gh-actions-node24-retired", 2),
					runs: [
						run("2026-08-01T03:17:00Z", "dddddddddddd", [result("flux.serve.start", 70)]),
					],
				},
			},
		});
		expect(html).not.toContain("gh-actions-node24-retired");
		expect(html).toContain("(local)");
	});

	it("escapes labels from the history", () => {
		const html = buildBenchmarkHtml(history);
		expect(html).toContain("spawn &lt;to&gt; ready");
		expect(html).not.toContain("spawn <to> ready");
	});
});

describe("trendSvg", () => {
	it("places a single point without dividing by a zero time range", () => {
		const svg = trendSvg([
			{
				color: "red",
				points: [{ time: 1, date: "2026-10-20", sha: "abc", median: 5, p90: 6 }],
			},
		]);
		expect(svg).toContain("<circle");
		expect(svg).not.toContain("NaN");
	});

	it("draws nothing when no machine has a point", () => {
		expect(trendSvg([])).toBe("");
	});
});
