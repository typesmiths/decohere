import path from "node:path";
import {
	PackageJson,
	packageAliases,
	Workspace,
	WorkspaceDefaults,
} from "@decohere/workspace";
import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { afterEach, expect, it } from "vitest";

afterEach(() => {
	resetMemfs();
});

function libWorkspace(rootDir = "/ws") {
	// Aliases point at entries that exist.
	vol.mkdirSync(`${rootDir}/projects/lib/src`, { recursive: true });
	vol.writeFileSync(`${rootDir}/projects/lib/src/index.ts`, "");
	return new Workspace({
		config: { ...WorkspaceDefaults, rootDir },
		projects: [
			{
				name: "@hmr/lib",
				config: {
					...WorkspaceDefaults,
					rootDir,
					projectDir: "projects/lib",
					packageJson: new PackageJson({ name: "@hmr/lib", main: "src/index.ts" }),
				},
			},
		],
	});
}

it("maps workspace package names to source entries relative to the workspace root", () => {
	const aliases = libWorkspace().getPackageAliases("debug");
	expect(aliases.baseUrl).toBe(path.resolve("/ws"));
	expect(aliases.paths["@hmr/lib"]).toEqual(["projects/lib/src/index.ts"]);
	expect(aliases.paths["@hmr/lib/*"]).toEqual(["projects/lib/src/*"]);
});

it("lets workspace tsconfig paths override convention aliases", () => {
	vol.fromJSON({
		"/ws/tsconfig.json": JSON.stringify({
			compilerOptions: {
				baseUrl: "/ws",
				paths: { "@hmr/lib": ["projects/lib/src/override.ts"] },
			},
		}),
	});

	const aliases = libWorkspace().getPackageAliases("debug");
	expect(aliases.paths["@hmr/lib"]).toEqual(["projects/lib/src/override.ts"]);
	expect(aliases.paths["@hmr/lib/*"]).toEqual(["projects/lib/src/*"]);
});

const aliasPaths = {
	"@hmr/lib": ["projects/lib/src/index.ts"],
	"@hmr/lib/*": ["projects/lib/src/*"],
};

it("does not treat relative specifiers as packages", () => {
	expect(packageAliases.resolvePath("./dep-a.js", aliasPaths, "/workspace")).toBeNull();
});

it("maps an exact package name to its source entry", () => {
	expect(packageAliases.resolvePath("@hmr/lib", aliasPaths, "/workspace")).toBe(
		path.resolve("/workspace/projects/lib/src/index.ts"),
	);
});

it("maps a package subpath through the name/* alias", () => {
	expect(packageAliases.resolvePath("@hmr/lib/other", aliasPaths, "/workspace")).toBe(
		path.resolve("/workspace/projects/lib/src/other.ts"),
	);
});

it("maps a .js alias target to the corresponding .ts source", () => {
	expect(
		packageAliases.resolvePath(
			"@hmr/lib",
			{ "@hmr/lib": ["projects/lib/src/index.js"] },
			"/workspace",
		),
	).toBe(path.resolve("/workspace/projects/lib/src/index.ts"));
});

it("ignores node builtins, internals, and empty specifiers", () => {
	expect(packageAliases.resolvePath("node:fs", aliasPaths, "/workspace")).toBeNull();
	expect(packageAliases.resolvePath("#internal", aliasPaths, "/workspace")).toBeNull();
	expect(packageAliases.resolvePath("", aliasPaths, "/workspace")).toBeNull();
});

// Subpaths resolve from the package's exports and by convention, without tsconfig paths.
function publishedLayoutWorkspace() {
	vol.fromJSON({
		"/ws/projects/web/src/index.ts": "",
		"/ws/projects/web/src/auth/auth.extensions.ts": "",
		"/ws/projects/web/src/http/index.ts": "",
		"/ws/projects/util/src/io/index.ts": "",
	});
	const project = (name: string, projectDir: string, packageJson: PackageJson) => ({
		name,
		config: { ...WorkspaceDefaults, rootDir: "/ws", projectDir, packageJson },
	});
	return new Workspace({
		config: { ...WorkspaceDefaults, rootDir: "/ws" },
		projects: [
			// `main` and `exports` describe the published layout, as for a released package.
			project(
				"@t/web",
				"projects/web",
				new PackageJson({
					name: "@t/web",
					main: "index.js",
					exports: {
						".": { types: "./types/src/index.d.ts", import: "./es6/src/index.js" },
						"./auth": { import: "./es6/src/auth/auth.extensions.js" },
						"./gone": { import: "./es6/src/gone/index.js" },
					},
				}),
			),
			// Only subpaths, no root entry.
			project(
				"@t/util",
				"projects/util",
				new PackageJson({ name: "@t/util", main: "index.js" }),
			),
		],
	});
}

it("maps a published-layout main and exported subpaths back to their sources", () => {
	const { paths } = publishedLayoutWorkspace().getPackageAliases("debug");
	expect(paths["@t/web"]).toEqual(["projects/web/src/index.ts"]);
	expect(paths["@t/web/auth"]).toEqual(["projects/web/src/auth/auth.extensions.ts"]);
	expect(paths["@t/web/*"]).toEqual(["projects/web/src/*"]);
});

it("leaves out an exported subpath whose source does not exist", () => {
	const { paths } = publishedLayoutWorkspace().getPackageAliases("debug");
	expect(paths["@t/web/gone"]).toBeUndefined();
});

it("gives a package with only subpaths no bare alias, and resolves its subpaths under src", () => {
	const { paths, baseUrl } = publishedLayoutWorkspace().getPackageAliases("debug");
	expect(paths["@t/util"]).toBeUndefined();
	expect(paths["@t/util/*"]).toEqual(["projects/util/src/*"]);
	expect(packageAliases.resolvePath("@t/util/io", paths, baseUrl)).toBe(
		path.resolve("/ws/projects/util/src/io/index.ts"),
	);
});

it("resolves a wildcard subpath to the directory's index.ts when there is no <sub>.ts", () => {
	const { paths, baseUrl } = publishedLayoutWorkspace().getPackageAliases("debug");
	expect(packageAliases.resolvePath("@t/web/http", paths, baseUrl)).toBe(
		path.resolve("/ws/projects/web/src/http/index.ts"),
	);
});

// A UI package's components and styles aren't TypeScript, and Vite resolves them by package name too.
it("maps a subpath that names a file that isn't TypeScript to that file", () => {
	vol.fromJSON({
		"/workspace/projects/lib/src/Button.astro": "---\n---\n<button />",
		"/workspace/projects/lib/src/theme.css": "",
	});
	expect(packageAliases.resolvePath("@hmr/lib/Button.astro", aliasPaths, "/workspace")).toBe(
		path.resolve("/workspace/projects/lib/src/Button.astro"),
	);
	expect(packageAliases.resolvePath("@hmr/lib/theme.css", aliasPaths, "/workspace")).toBe(
		path.resolve("/workspace/projects/lib/src/theme.css"),
	);
});
