/**
 * The facade and the JSON console adapter run on Workers, in browsers,
 * Deno and Bun. The behavior suites cover the paths they run without `process`;
 * this guard covers the paths they don't.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { realFs } from "../../../../test/fs.setup.js";

const packages = [
	join(import.meta.dirname, "../src"),
	join(import.meta.dirname, "../../scribe-console/src"),
];

const nodeOnly = [
	{ name: "node: imports", pattern: /from\s+["']node:/ },
	{ name: "process (use globalThis.process?.)", pattern: /(?<!globalThis\.)\bprocess\./ },
	{ name: "Buffer", pattern: /\bBuffer\b/ },
	{ name: "require", pattern: /\brequire\(/ },
];

function sources(dir: string): string[] {
	return realFs
		.readdirSync(dir, { recursive: true, encoding: "utf8" })
		.filter((file) => file.endsWith(".ts"))
		.map((file) => join(dir, file));
}

describe("runtime portability", () => {
	it.each(packages)("%s uses no Node-only API", (dir) => {
		const found = sources(dir).flatMap((file) => {
			const text = realFs.readFileSync(file, "utf8");
			return nodeOnly
				.filter(({ pattern }) => pattern.test(text))
				.map(({ name }) => `${file}: ${name}`);
		});
		expect(found).toEqual([]);
	});
});
