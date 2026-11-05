import { vol } from "memfs";
import { afterEach, describe, expect, it } from "vitest";
import { restampBuild } from "../../src/release/restamp-build.mjs";

const FROM = "0.0.1-dev.20261105.110";
const TO = "0.1.0";

function manifest(name: string, extra: object = {}) {
	return JSON.stringify({ name, version: FROM, ...extra });
}

function read(path: string) {
	return JSON.parse(String(vol.readFileSync(path, "utf8")));
}

afterEach(() => {
	vol.reset();
});

describe("restampBuild", () => {
	it("changes the version and @decohere pins, and nothing else", () => {
		const code = "export const a = 1;\n";
		vol.fromJSON({
			"/dist/projects/http/package.json": manifest("@decohere/http", {
				dependencies: { "@decohere/core": FROM, fastify: "^5.0.0" },
				peerDependencies: { "@decohere/config": FROM },
			}),
			"/dist/projects/http/es6/src/index.js": code,
			"/dist/projects/core/package.json": manifest("@decohere/core"),
		});

		const result = restampBuild({ dir: "/dist", from: FROM, to: TO });

		expect(result.packages).toEqual(["@decohere/core", "@decohere/http"]);
		expect(read("/dist/projects/http/package.json")).toEqual({
			name: "@decohere/http",
			version: TO,
			dependencies: { "@decohere/core": TO, fastify: "^5.0.0" },
			peerDependencies: { "@decohere/config": TO },
		});
		expect(vol.readFileSync("/dist/projects/http/es6/src/index.js", "utf8")).toBe(code);
	});

	it("refuses a build holding the old version anywhere else, changing nothing", () => {
		vol.fromJSON({
			"/dist/projects/core/package.json": manifest("@decohere/core"),
			"/dist/projects/core/es6/src/version.js": `export const VERSION = "${FROM}";\n`,
		});

		expect(() => restampBuild({ dir: "/dist", from: FROM, to: TO })).toThrow(
			"projects/core/es6/src/version.js",
		);
		expect(read("/dist/projects/core/package.json").version).toBe(FROM);
	});

	it("refuses a package at a different version, changing nothing", () => {
		vol.fromJSON({
			"/dist/projects/core/package.json": manifest("@decohere/core"),
			"/dist/projects/http/package.json": JSON.stringify({
				name: "@decohere/http",
				version: "9.9.9",
			}),
		});

		expect(() => restampBuild({ dir: "/dist", from: FROM, to: TO })).toThrow("@decohere/http");
		expect(read("/dist/projects/core/package.json").version).toBe(FROM);
	});

	it("refuses a build with no packages", () => {
		vol.fromJSON({ "/dist/readme.txt": "nothing" });

		expect(() => restampBuild({ dir: "/dist", from: FROM, to: TO })).toThrow("No packages");
	});

	it.each(["0.1", "v0.1.0", "0.1.0-dev.1", "0.1.0; rm -rf /"])(
		"refuses %s as a stable version",
		(to) => {
			vol.fromJSON({ "/dist/projects/core/package.json": manifest("@decohere/core") });

			expect(() => restampBuild({ dir: "/dist", from: FROM, to })).toThrow("stable version");
		},
	);
});
