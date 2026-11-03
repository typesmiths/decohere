/**
 * The benchmark page on Pages: a trend chart per benchmark and a table of the latest
 * results, from the version 2 history (../bench/history.mjs). Static HTML and inline SVG, so the
 * page needs no script and no third-party chart library.
 */

import { REGRESSION, STALE_AFTER_DAYS } from "../bench/history.mjs";

const GROUPS = [
	{ prefix: "flux.serve.", title: "flux serve (real process)" },
	{ prefix: "flux.load.", title: "flux load (in process)" },
	{ prefix: "flux.transpile.", title: "Transpile strategies (SWC only)" },
	{ prefix: "forge.build.", title: "forge build" },
];

const SERIES_COLORS = [
	"var(--series-1)",
	"var(--series-2)",
	"var(--series-3)",
	"var(--series-4)",
];

function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function fmtMs(ms) {
	if (typeof ms !== "number" || Number.isNaN(ms)) return "–";
	if (ms === 0) return "0 ms";
	if (ms >= 100) return `${Math.round(ms)} ms`;
	return `${ms.toFixed(1)} ms`;
}

/** `2026-10-20 03:17 UTC`: when a run happened, to the minute. */
function fmtDate(iso) {
	return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function commitLink(repoUrl, sha) {
	if (sha == null) return "–";
	return `<a href="${escapeHtml(`${repoUrl}/commit/${sha}`)}"><code>${escapeHtml(sha.slice(0, 7))}</code></a>`;
}

function machineName(context) {
	return `${context.benchEnv ?? "unknown"} · ${context.cpu.model} × ${context.cpu.count}`;
}

/**
 * Contexts with a run within STALE_AFTER_DAYS of the newest run anywhere, most recently run first:
 * CI runner types come and go, and one that stopped appearing would otherwise keep a line.
 */
function activeContexts(history) {
	const newest = Math.max(
		...Object.values(history.contexts ?? {})
			.filter((entry) => entry.runs.length > 0)
			.map((entry) => new Date(entry.runs[0].date).getTime()),
	);
	const cutoff = newest - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;
	return Object.entries(history.contexts ?? {})
		.filter(([, entry]) => entry.runs.length > 0)
		.filter(([, entry]) => new Date(entry.runs[0].date).getTime() >= cutoff)
		.sort((a, b) => new Date(b[1].runs[0].date) - new Date(a[1].runs[0].date))
		.map(([id, entry], index) => ({
			id,
			context: entry.context,
			runs: entry.runs,
			color: SERIES_COLORS[index % SERIES_COLORS.length],
		}));
}

/** Every benchmark id seen in any run, with the label from its newest run on any machine. */
function benchmarkIds(contexts) {
	const newest = new Map();
	for (const { runs } of contexts) {
		for (const run of runs) {
			const time = new Date(run.date).getTime();
			for (const result of run.results) {
				const seen = newest.get(result.id);
				if (seen == null || time > seen.time)
					newest.set(result.id, { time, label: result.label });
			}
		}
	}
	return new Map([...newest].map(([id, { label }]) => [id, label]));
}

/** Oldest-first points for one benchmark on one machine. */
function seriesFor(runs, id) {
	return [...runs]
		.reverse()
		.map((run) => ({ run, result: run.results.find((result) => result.id === id) }))
		.filter((point) => point.result != null)
		.map(({ run, result }) => ({
			time: new Date(run.date).getTime(),
			date: run.date.slice(0, 10),
			iso: run.date,
			sha: run.sha,
			median: result.median,
			p90: result.p90,
		}));
}

/** A line chart of medians over time, one line per machine, with a hover title per point. */
export function trendSvg(lines) {
	const width = 560;
	const height = 180;
	const pad = { top: 12, right: 12, bottom: 24, left: 56 };
	const points = lines.flatMap((line) => line.points);
	if (points.length === 0) return "";
	const minTime = Math.min(...points.map((p) => p.time));
	const maxTime = Math.max(...points.map((p) => p.time));
	const maxValue = Math.max(...points.map((p) => p.p90 ?? p.median)) * 1.1 || 1;
	const x = (time) =>
		maxTime === minTime
			? pad.left + (width - pad.left - pad.right) / 2
			: pad.left + ((time - minTime) / (maxTime - minTime)) * (width - pad.left - pad.right);
	const y = (value) => pad.top + (1 - value / maxValue) * (height - pad.top - pad.bottom);
	const ticks = [0, 0.5, 1].map((fraction) => maxValue * fraction);
	const grid = ticks
		.map(
			(value) =>
				`<line class="grid" x1="${pad.left}" x2="${width - pad.right}" y1="${y(value)}" y2="${y(value)}"/>` +
				`<text class="axis" x="${pad.left - 6}" y="${y(value) + 4}" text-anchor="end">${fmtMs(value)}</text>`,
		)
		.join("");
	const dateLabels = [
		{ time: minTime, anchor: "start" },
		...(maxTime !== minTime ? [{ time: maxTime, anchor: "end" }] : []),
	]
		.map(
			({ time, anchor }) =>
				`<text class="axis" x="${x(time)}" y="${height - 6}" text-anchor="${anchor}">${new Date(time).toISOString().slice(0, 10)}</text>`,
		)
		.join("");
	const series = lines
		.map((line) => {
			const path = line.points
				.map((p) => `${x(p.time).toFixed(1)},${y(p.median).toFixed(1)}`)
				.join(" ");
			const dots = line.points
				.map(
					(p) =>
						`<circle cx="${x(p.time).toFixed(1)}" cy="${y(p.median).toFixed(1)}" r="3" style="fill:${line.color}"><title>${escapeHtml(
							`${p.date}${p.sha ? ` · ${p.sha.slice(0, 7)}` : ""} · median ${fmtMs(p.median)}${p.p90 != null ? ` · p90 ${fmtMs(p.p90)}` : ""}`,
						)}</title></circle>`,
				)
				.join("");
			return `<polyline points="${path}" style="stroke:${line.color}"/>${dots}`;
		})
		.join("");
	return `<svg class="trend" viewBox="0 0 ${width} ${height}" role="img" aria-label="Median over time">${grid}${dateLabels}${series}</svg>`;
}

function changeText(points) {
	const last = points.at(-1);
	const before = points.at(-2);
	if (last == null || before == null || before.median === 0) return "";
	const percent = ((last.median - before.median) / before.median) * 100;
	const direction = percent > 0 ? "slower" : "faster";
	if (Math.abs(percent) < 0.5) return `<span class="change">no change</span>`;
	return `<span class="change ${percent > 0 ? "worse" : "better"}">${Math.abs(percent).toFixed(1)}% ${direction}</span>`;
}

function card(id, label, contexts) {
	const lines = contexts
		.map((ctx) => ({
			color: ctx.color,
			name: machineName(ctx.context),
			points: seriesFor(ctx.runs, id),
		}))
		.filter((line) => line.points.length > 0);
	const primary = lines[0];
	const latest = primary?.points.at(-1);
	return `<article class="card">
  <header>
    <h3>${escapeHtml(label)}</h3>
    <code>${escapeHtml(id)}</code>
  </header>
  <p class="latest"><strong>${fmtMs(latest?.median)}</strong> median${latest?.p90 != null ? ` · p90 ${fmtMs(latest.p90)}` : ""} ${primary ? changeText(primary.points) : ""}</p>
  <p class="when">${latest != null ? `Last run ${escapeHtml(fmtDate(latest.iso))}` : ""}</p>
  ${trendSvg(lines)}
</article>`;
}

function latestTable(contexts, labels, repoUrl) {
	const rows = contexts.flatMap((ctx) =>
		ctx.runs[0].results.map(
			(result) => `<tr>
  <td><span class="swatch" style="background:${ctx.color}"></span>${escapeHtml(ctx.context.benchEnv ?? "unknown")}</td>
  <td>${escapeHtml(fmtDate(ctx.runs[0].date))}</td>
  <td>${commitLink(repoUrl, ctx.runs[0].sha)}</td>
  <td>${escapeHtml(labels.get(result.id) ?? result.label)}</td>
  <td class="num">${fmtMs(result.median)}</td>
  <td class="num">${fmtMs(result.p90)}</td>
  <td class="num">${fmtMs(result.min)}</td>
  <td class="num">${result.files ?? "–"}</td>
  <td class="num">${result.samples}</td>
</tr>`,
		),
	);
	return `<div class="table-wrap"><table>
  <thead><tr><th>Machine</th><th>Run</th><th>Commit</th><th>Benchmark</th><th class="num">Median</th><th class="num">p90</th><th class="num">Min</th><th class="num">Files</th><th class="num">Samples</th></tr></thead>
  <tbody>${rows.join("\n")}</tbody>
</table></div>`;
}

export function buildBenchmarkHtml(
	history,
	{ branch = "local", sha = "local", repoUrl = "https://github.com/typesmiths/decohere" } = {},
) {
	const contexts = activeContexts(history);
	const body =
		contexts.length === 0
			? `<p class="empty">No benchmark history yet. The nightly bench workflow adds a run each night.</p>`
			: (() => {
					const labels = benchmarkIds(contexts);
					const grouped = GROUPS.map((group) => ({
						...group,
						ids: [...labels.keys()].filter((id) => id.startsWith(group.prefix)),
					}));
					const other = [...labels.keys()].filter(
						(id) => !GROUPS.some((group) => id.startsWith(group.prefix)),
					);
					if (other.length > 0) grouped.push({ title: "Other", ids: other });
					const sections = grouped
						.filter((group) => group.ids.length > 0)
						.map(
							(group) => `<section>
  <h2>${escapeHtml(group.title)}</h2>
  <div class="cards">${group.ids.map((id) => card(id, labels.get(id), contexts)).join("\n")}</div>
</section>`,
						)
						.join("\n");
					const legend = contexts
						.map(
							(ctx) =>
								`<li><span class="swatch" style="background:${ctx.color}"></span>${escapeHtml(machineName(ctx.context))} · ${escapeHtml(ctx.context.os.platform)} ${escapeHtml(ctx.context.os.arch)} · ${ctx.context.memoryGb} GB · Node ${escapeHtml(ctx.context.node)} · ${ctx.runs.length} run(s)</li>`,
						)
						.join("\n");
					return `<section class="machines"><h2>Machines</h2><ul>${legend}</ul>
<p class="note">Each line is one machine type; runs are only compared on the same one. Shared CI runners are noisy, so read the trend, not a single point. Hover a point for its date, commit and p90. Each night also benchmarks the previous nightly's commit on the same runner, alternating ${REGRESSION.rounds} rounds each; a benchmark more than ${Math.round(REGRESSION.threshold * 100)}% slower in every round gets an issue: <a href="${escapeHtml(`${repoUrl}/issues?q=is%3Aissue+is%3Aopen+%22perf(bench)%22`)}">open benchmark issues</a>.</p></section>
${sections}
<section><h2>Latest run</h2>${latestTable(contexts, labels, repoUrl)}</section>`;
				})();
	const updated = contexts[0]?.runs[0].date.slice(0, 10) ?? "never";
	return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Decohere Benchmarks</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main class="container">
      <header class="hero">
        <h1>Decohere benchmarks</h1>
        <p>Updated ${escapeHtml(updated)} · built from ${escapeHtml(branch)} @ <code>${escapeHtml(sha.slice(0, 12))}</code> · <a href="./data/bench-history.json">raw data</a></p>
      </header>
      ${body}
    </main>
  </body>
</html>
`;
}

export function buildStylesCss() {
	return `:root {
  --bg: #f6f7f9; --surface: #ffffff; --text: #1b1f24; --muted: #59636e; --border: #d8dee4;
  --accent: #0b6e4f; --better: #1a7f37; --worse: #cf222e;
  --series-1: #0b6e4f; --series-2: #8250df; --series-3: #bc4c00; --series-4: #0969da;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0d1117; --surface: #161b22; --text: #e6edf3; --muted: #9198a1; --border: #30363d;
    --accent: #3fb68b; --better: #3fb950; --worse: #f85149;
    --series-1: #3fb68b; --series-2: #a371f7; --series-3: #f0883e; --series-4: #4493f8;
  }
}
:root[data-theme="dark"] {
  --bg: #0d1117; --surface: #161b22; --text: #e6edf3; --muted: #9198a1; --border: #30363d;
  --accent: #3fb68b; --better: #3fb950; --worse: #f85149;
  --series-1: #3fb68b; --series-2: #a371f7; --series-3: #f0883e; --series-4: #4493f8;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
a { color: var(--accent); }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.85em; }
.container { max-width: 1180px; margin: 0 auto; padding: 24px 16px 64px; }
.hero h1 { margin: 0 0 4px; font-size: 1.6rem; }
.hero p, .note, .empty { color: var(--muted); margin: 0; }
section { margin-top: 32px; }
h2 { font-size: 1.1rem; margin: 0 0 12px; }
.machines ul { list-style: none; padding: 0; margin: 0 0 8px; }
.machines li { margin: 4px 0; }
.swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 8px; vertical-align: baseline; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 360px), 1fr)); gap: 16px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; min-width: 0; }
.card header { display: flex; flex-direction: column; gap: 2px; }
.card h3 { font-size: 0.95rem; margin: 0; }
.card header code { color: var(--muted); }
.latest { margin: 8px 0 0; }
.when { margin: 0 0 4px; color: var(--muted); font-size: 0.85rem; }
.latest strong { font-size: 1.25rem; font-variant-numeric: tabular-nums; }
.change { margin-left: 6px; font-size: 0.85rem; color: var(--muted); }
.change.better { color: var(--better); }
.change.worse { color: var(--worse); }
.trend { width: 100%; height: auto; display: block; }
.trend polyline { fill: none; stroke-width: 2; }
.trend .grid { stroke: var(--border); stroke-width: 1; }
.trend .axis { fill: var(--muted); font-size: 11px; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; font-variant-numeric: tabular-nums; }
th, td { padding: 8px 10px; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; }
th { color: var(--muted); font-weight: 600; }
.num { text-align: right; }
`;
}
