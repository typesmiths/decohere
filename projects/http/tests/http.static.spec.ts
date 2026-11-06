import { describe, expect, it } from "vitest";
import { STATIC_DEFAULT_IMMUTABLE, staticFiles } from "../src/http/http.static.js";

describe("static file rules", () => {
	it.each([
		"assets/index-DiwrgTda.js",
		"assets/index-3f9a8c1b.js",
		"assets/style.3f9a8c1b.css",
		"assets/vendor-x9Kd02_a.js.map",
		"chunk-1a2b3c4d5e6f.js",
	])("treats %s as hashed", (file) => {
		expect(STATIC_DEFAULT_IMMUTABLE.test(file)).toBe(true);
	});

	it.each([
		"index.html",
		"remoteEntry.js",
		"favicon.ico",
		"assets/logo-background.png",
		"assets/short-abc123.js",
		"fonts/inter.woff2",
		"main.min.js",
	])("does not treat %s as hashed", (file) => {
		expect(STATIC_DEFAULT_IMMUTABLE.test(file)).toBe(false);
	});

	it.each([
		["/ui/", "/ui/"],
		["/ui", "/ui/"],
		["ui", "/ui/"],
		["//apps//crypto/", "/apps/crypto/"],
		["/", "/"],
		["//", "/"],
	])("mounts %s at %s", (given, expected) => {
		expect(staticFiles.toMount(given, "ui").prefix).toBe(expected);
	});

	it.each(["", "/ui/../api", "/ui/*"])("refuses the prefix %j", (given) => {
		expect(() => staticFiles.toMount(given, "ui")).toThrow(/static/i);
	});

	it.each([
		["/portfolio", false],
		["/portfolio/42/edit", false],
		["/portfolio/", false],
		["/", false],
		["/app.js", true],
		["/assets/x.map", true],
		["/.env", true],
		["/.well-known/x", true],
		["/v1.2/overview/", false],
	])("treats %s as a file: %s", (pathname, expected) => {
		expect(staticFiles.looksLikeFile(pathname)).toBe(expected);
	});

	it.each([
		["text/html", true],
		["text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", true],
		["application/json, TEXT/HTML;q=0.5", true],
		["text/html;q=0", false],
		["application/json", false],
		["*/*", false],
		["text/*", false],
		["", false],
		[undefined, false],
	])("reads the Accept header %j as html: %s", (accept, expected) => {
		expect(staticFiles.acceptsHtml(accept)).toBe(expected);
	});

	it("takes the first segment of every route that is not a parameter", () => {
		const segments = staticFiles.routeSegments([
			"/lp/portfolio",
			"/health",
			"/:id",
			"/*",
			"/",
			"/lp/x",
		]);

		expect([...segments].sort()).toEqual(["health", "lp"]);
	});

	it.each([
		["/lp/portfolo", true],
		["/lp", true],
		["/lp/a/b/c", true],
		["/lpx", false],
		["/portfolio", false],
		["/", false],
	])("decides whether %s is under a route: %s", (pathname, expected) => {
		expect(staticFiles.isUnderRoute(pathname, new Set(["lp", "health"]))).toBe(expected);
	});

	it.each([
		[["/api/**"], "/api/x", true],
		[["/api/**"], "/api", true],
		[["/api/**"], "/apix", false],
		[["/docs/*"], "/docs/a/b", false],
		[["/docs/*"], "/docs/a", true],
		[["/api/**", "/docs/**"], "/docs/a/b", true],
		[["/api/**"], "/api/.hidden", true],
		[[], "/api/x", false],
	])("matches exclude %j against %s: %s", (patterns, pathname, expected) => {
		expect(staticFiles.excluder(patterns)(pathname)).toBe(expected);
	});

	it("normalises the path: no query, decoded, one slash", () => {
		expect(staticFiles.normalizePathname("//api%2Fx//y?z=1")).toBe("/api/x/y");
		expect(staticFiles.normalizePathname("/bad%zz")).toBe("/bad%zz");
	});
});
