import { createRequire } from "node:module";
import path from "node:path";
import { ForgeModule } from "@decohere/forge";
import { Caching } from "@decohere/core/caching";
import { Docker as DockerInterop, Npm } from "@decohere/devkit/interop";
import { io } from "@decohere/core/io";
import { fileExists, resetMemfs } from "@decohere/testing";
import { fs, vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RootModule } from "../src/root.module.js";

beforeEach(() => {
	vi.spyOn(process, "cwd").mockReturnValue("/");
});

afterEach(() => {
	resetMemfs();
	Caching.flushAllCaches();
	vi.restoreAllMocks();
});

const fixtureDir = new URL("__fixtures__", import.meta.url).pathname;
const configFile = `${fixtureDir}/.decohere.js`;

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------

describe("forge command registration", () => {
	it("registers forge as a top-level command with all expected subcommands", async () => {
		const app = await RootModule.create([ForgeModule]);
		const forgeCommand = app.commands.find((c) => c.name() === "forge");
		expect(forgeCommand).toBeDefined();
		expect(forgeCommand?.commands.map((c) => c.name())).toEqual(
			expect.arrayContaining([
				"build",
				"docker",
				"package",
				"publish",
				"dependencies",
				"version",
				"tag",
				"link",
				"unlink",
				"typecheck",
			]),
		);
	});

	it("merges user-defined commands from forge config", async () => {
		vol.fromJSON({
			[configFile]: `
			import { Command } from 'commander';
			class MOCK_COMMAND extends Command {}
			export default { forge: { commands: { mock: MOCK_COMMAND } } }
			`,
		});

		const app = await RootModule.create([ForgeModule], { configFile });
		expect(app.commands.at(0).commands).toContainEqual(
			expect.objectContaining({ _name: "mock" }),
		);
	});
});

// ---------------------------------------------------------------------------
// forge link
// ---------------------------------------------------------------------------

describe("forge link", () => {
	const workspaceFiles = {
		"/package.json": JSON.stringify({ name: "ROOT", version: "1.0.0" }),
		"/projects/lib1/package.json": JSON.stringify({ name: "lib1", version: "1.0.0" }),
		"/projects/lib1/src/index.ts": "export const value = 1;",
		// Pre-built link-configuration output (normally produced by forge build --configuration link)
		"/dist/link/projects/lib1/src/index.js": "export const value = 1;",
		"/dist/link/projects/lib1/src/index.d.ts": "export declare const value = 1;",
		"/target/node_modules/.keep": "",
	};

	it("registers link and unlink as top-level forge commands", async () => {
		const app = await RootModule.create([ForgeModule]);
		const forgeCommand = app.commands.find((c) => c.name() === "forge");
		const names = forgeCommand?.commands.map((c) => c.name());
		expect(names).toContain("link");
		expect(names).toContain("unlink");
	});

	it("creates symlinks in target node_modules for each workspace package", async () => {
		vol.fromJSON(workspaceFiles);

		const app = await RootModule.create([ForgeModule]);
		await app.run(["forge", "link", "--target-dir", "/target"]);

		const stat = await fs.promises.lstat("/target/node_modules/lib1");
		expect(stat.isSymbolicLink()).toBe(true);
		const target = await fs.promises.readlink("/target/node_modules/lib1");
		expect(target).toContain("dist/link/projects/lib1");
	});

	it("removes symlinks and deletes the manifest when unlink is run", async () => {
		vol.fromJSON(workspaceFiles);

		const app = await RootModule.create([ForgeModule]);
		await app.run(["forge", "link", "--target-dir", "/target"]);
		await app.run(["forge", "unlink", "--target-dir", "/target"]);

		const stat = await fs.promises.lstat("/target/node_modules/lib1").catch(() => null);
		expect(stat).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// forge build
// ---------------------------------------------------------------------------

describe("forge build", () => {
	const projectFiles = {
		"/package.json": JSON.stringify({ name: "ROOT", version: "1.0.0" }),
		"/projects/lib1/package.json": JSON.stringify({ name: "lib1", version: "1.0.0" }),
		"/projects/lib1/src/index.ts": "export const value = 1;",
	};

	it("defaults to debug configuration and emits output under dist/debug/", async () => {
		vol.fromJSON(projectFiles);

		const app = await RootModule.create([ForgeModule]);
		const response = await app.run(["forge", "build"]);

		expect(response.build?.succeeded).toBe(true);
		// Debug config (pack=false): single flat output directory
		expect(fileExists("/dist/debug/projects/lib1/src/index.js")).toBe(true);
		// Release output must NOT be produced
		expect(fileExists("/dist/release")).toBe(false);
	});

	it("emits output under dist/release/ with multiple targets when --configuration release", async () => {
		vol.fromJSON(projectFiles);

		const app = await RootModule.create([ForgeModule]);
		const response = await app.run(["forge", "build", "--configuration", "release"]);

		expect(response.build?.succeeded).toBe(true);
		// Release config (pack=true): each target gets its own sub-directory
		expect(fileExists("/dist/release/projects/lib1/es6/src/index.js")).toBe(true);
		expect(fileExists("/dist/release/projects/lib1/commonjs/src/index.js")).toBe(true);
		// Debug output must NOT be produced
		expect(fileExists("/dist/debug")).toBe(false);
	});

	// Inline source maps embed the full TypeScript source and the build machine's
	// absolute paths in every published file. Release output has none; debug keeps them.
	it("emits release JavaScript without inline source maps, debug with them", async () => {
		vol.fromJSON(projectFiles);
		const app = await RootModule.create([ForgeModule]);

		await app.run(["forge", "build", "--configuration", "release"]);
		await app.run(["forge", "build", "--configuration", "debug"]);

		const read = (p: string) => vol.readFileSync(p, "utf8") as string;
		expect(read("/dist/release/projects/lib1/es6/src/index.js")).not.toContain(
			"sourceMappingURL",
		);
		expect(read("/dist/release/projects/lib1/commonjs/src/index.js")).not.toContain(
			"sourceMappingURL",
		);
		expect(read("/dist/debug/projects/lib1/src/index.js")).toContain("sourceMappingURL");
	});
});

// ---------------------------------------------------------------------------
// forge typecheck
// ---------------------------------------------------------------------------

describe("forge typecheck", () => {
	const checkTsconfig = JSON.stringify({
		compilerOptions: {
			strict: true,
			skipLibCheck: true,
		},
	});

	async function workspaceWith(source: string): Promise<Record<string, string>> {
		const { readdirSync, readFileSync } =
			await vi.importActual<typeof import("node:fs")>("node:fs");
		const require = createRequire(import.meta.url);
		const libDir = path.dirname(require.resolve("typescript"));
		const libFiles: Record<string, string> = {};
		for (const name of readdirSync(libDir) as string[]) {
			if (!name.startsWith("lib.") || !name.endsWith(".d.ts")) {
				continue;
			}
			libFiles[path.join(libDir, name)] = readFileSync(path.join(libDir, name), "utf8");
		}
		return {
			...libFiles,
			"/package.json": JSON.stringify({ name: "ROOT", version: "1.0.0" }),
			"/tsconfig.json": checkTsconfig,
			"/projects/lib1/package.json": JSON.stringify({ name: "lib1", version: "1.0.0" }),
			"/projects/lib1/src/index.ts": source,
		};
	}

	it("succeeds without writing JS or declaration files", async () => {
		vol.fromJSON(await workspaceWith("export const value: number = 1;"));

		const app = await RootModule.create([ForgeModule]);
		const response = await app.run(["forge", "typecheck"]);

		expect(response.typecheck?.succeeded).toBe(true);
		expect(fileExists("/projects/lib1/src/index.js")).toBe(false);
		expect(fileExists("/projects/lib1/src/index.d.ts")).toBe(false);
		expect(fileExists("/dist")).toBe(false);
	});

	it("fails on a type error and does not emit files", async () => {
		vol.fromJSON(await workspaceWith('export const value: number = "not a number";'));

		const app = await RootModule.create([ForgeModule]);
		await expect(app.run(["forge", "typecheck"])).rejects.toThrow(/not assignable/i);

		expect(fileExists("/projects/lib1/src/index.js")).toBe(false);
		expect(fileExists("/projects/lib1/src/index.d.ts")).toBe(false);
		expect(fileExists("/dist")).toBe(false);
	});

	it("does not type-check during forge build — a type error still emits JS", async () => {
		vol.fromJSON(await workspaceWith('export const value: number = "not a number";'));

		const app = await RootModule.create([ForgeModule]);
		const response = await app.run(["forge", "build"]);

		expect(response.build?.succeeded).toBe(true);
		expect(fileExists("/dist/debug/projects/lib1/src/index.js")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// forge docker
// ---------------------------------------------------------------------------

describe("forge docker", () => {
	it("calls docker build and push with expected args", async () => {
		vol.fromJSON({
			"/package.json": JSON.stringify({
				name: "ROOT",
				version: "1.2.3",
				repository: "github:typesmiths/decohere",
			}),
			"/projects/create/package.json": JSON.stringify({
				name: "@decohere/create",
				version: "0.0.1",
			}),
			"/projects/create/Dockerfile": "FROM node:24-slim\n",
		});

		const buildSpy = vi
			.spyOn(DockerInterop.prototype, "build")
			.mockResolvedValue({ message: "built", data: [] });
		const pushSpy = vi
			.spyOn(DockerInterop.prototype, "push")
			.mockResolvedValue({ message: "pushed", data: [] });

		const app = await RootModule.create([ForgeModule]);
		const response = await app.run(["forge", "docker", "--push"]);

		expect(response.docker?.succeeded).toBe(true);
		expect(buildSpy).toHaveBeenCalledWith(
			"/projects/create",
			expect.objectContaining({
				cwd: "/projects/create",
				dockerfile: "/projects/create/Dockerfile",
				tags: ["ghcr.io/typesmiths/decohere/create:1.2.3"],
			}),
		);
		expect(pushSpy).toHaveBeenCalledWith("ghcr.io/typesmiths/decohere/create:1.2.3", {
			cwd: "/projects/create",
		});
	});

	it("builds without pushing in dry-run mode", async () => {
		vol.fromJSON({
			"/package.json": JSON.stringify({
				name: "ROOT",
				version: "1.2.3",
				repository: "github:typesmiths/decohere",
			}),
			"/projects/create/package.json": JSON.stringify({
				name: "@decohere/create",
				version: "0.0.1",
			}),
			"/projects/create/Dockerfile": "FROM node:24-slim\n",
		});

		const buildSpy = vi
			.spyOn(DockerInterop.prototype, "build")
			.mockResolvedValue({ message: "built", data: [] });
		const pushSpy = vi
			.spyOn(DockerInterop.prototype, "push")
			.mockResolvedValue({ message: "pushed", data: [] });

		const app = await RootModule.create([ForgeModule]);
		const response = await app.run(["forge", "docker", "--dry-run"]);

		expect(response.docker?.succeeded).toBe(true);
		expect(buildSpy).toHaveBeenCalledOnce();
		expect(pushSpy).not.toHaveBeenCalled();
	});

	it("does not push when dry-run and --push are both set", async () => {
		vol.fromJSON({
			"/package.json": JSON.stringify({
				name: "ROOT",
				version: "1.2.3",
				repository: "github:typesmiths/decohere",
			}),
			"/projects/create/package.json": JSON.stringify({
				name: "@decohere/create",
				version: "0.0.1",
			}),
			"/projects/create/Dockerfile": "FROM node:24-slim\n",
		});

		const buildSpy = vi
			.spyOn(DockerInterop.prototype, "build")
			.mockResolvedValue({ message: "built", data: [] });
		const pushSpy = vi
			.spyOn(DockerInterop.prototype, "push")
			.mockResolvedValue({ message: "pushed", data: [] });

		const app = await RootModule.create([ForgeModule]);
		const response = await app.run(["forge", "docker", "--dry-run", "--push"]);

		expect(response.docker?.succeeded).toBe(true);
		expect(buildSpy).toHaveBeenCalledOnce();
		expect(pushSpy).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// forge dependencies sync
//
// These tests are the primary regression guard for configuration routing.
// The bug that prompted this suite: RootCommand defined ConfigurationOption("debug")
// globally, which Commander's optsWithGlobals() let override DependencyCommand's
// default of "release". Any reintroduction of a global ConfigurationOption will
// break the first two tests below.
// ---------------------------------------------------------------------------

describe("forge dependencies sync", () => {
	const rootFiles = {
		"/package.json": JSON.stringify({
			name: "ROOT",
			version: "1.0.0",
			dependencies: { axios: "^1.0.0" },
			devDependencies: { vitest: "^3.0.0" },
		}),
		"/projects/app/package.json": JSON.stringify({
			name: "@MOCK_ORG/MOCK_APP",
			version: "1.0.0",
			dependencies: {},
			devDependencies: {},
		}),
		"/projects/app/src/index.ts": `import axios from "axios";`,
		"/projects/app/tests/helpers.ts": `import { vi } from "vitest";`,
		"/projects/app/tests/index.spec.ts": `import { describe, it } from "vitest";`,
	};

	it("defaults to release configuration — test files are excluded so vitest never appears", async () => {
		// Regression: if a global ConfigurationOption("debug") is re-added to RootCommand,
		// Commander will resolve "debug" here instead of "release", causing test files to be
		// scanned and vitest to appear in devDependencies.
		vol.fromJSON(rootFiles);

		const app = await RootModule.create([ForgeModule]);
		const response = await app.run(["forge", "dependencies", "sync", "--no-sync"]);

		expect(response.syncDependencies?.succeeded).toBe(true);
		const written = await io.readJsonFile<{
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		}>("/projects/app/package.json");
		expect(written.dependencies).toEqual({ axios: "^1.0.0" });
		expect(written.devDependencies).not.toHaveProperty("vitest");
	});

	it("uses release configuration when --configuration release is passed explicitly", async () => {
		vol.fromJSON(rootFiles);

		const app = await RootModule.create([ForgeModule]);
		const response = await app.run([
			"forge",
			"dependencies",
			"sync",
			"--no-sync",
			"--configuration",
			"release",
		]);

		expect(response.syncDependencies?.succeeded).toBe(true);
		const written = await io.readJsonFile<{
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		}>("/projects/app/package.json");
		expect(written.dependencies).toEqual({ axios: "^1.0.0" });
		expect(written.devDependencies).not.toHaveProperty("vitest");
	});

	it("scans test files when --configuration debug is passed — vitest appears in devDependencies", async () => {
		// Debug config has no ignore patterns for tests/, so test helpers that import vitest
		// ARE scanned. This is the complementary assertion to the default-release test above:
		// both must pass independently for configuration routing to be correct.
		vol.fromJSON(rootFiles);

		const app = await RootModule.create([ForgeModule]);
		const response = await app.run([
			"forge",
			"dependencies",
			"sync",
			"--no-sync",
			"--configuration",
			"debug",
		]);

		expect(response.syncDependencies?.succeeded).toBe(true);
		const written = await io.readJsonFile<{
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		}>("/projects/app/package.json");
		expect(written.devDependencies).toHaveProperty("vitest");
	});

	it("writes resolved dependencies to disk when --no-sync is not passed", async () => {
		vol.fromJSON(rootFiles);

		const app = await RootModule.create([ForgeModule]);
		await app.run(["forge", "dependencies", "sync"]);

		const written = await io.readJsonFile<{ dependencies?: Record<string, string> }>(
			"/projects/app/package.json",
		);
		expect(written.dependencies).toEqual({ axios: "^1.0.0" });
	});

	it("throws when a project imports a missing package", async () => {
		vol.fromJSON({
			...rootFiles,
			"/projects/app/src/index.ts": `import missing from "not-installed";`,
		});

		const app = await RootModule.create([ForgeModule]);
		await expect(app.run(["forge", "dependencies", "sync", "--no-sync"])).rejects.toThrow(
			"not-installed",
		);
	});
});

// ---------------------------------------------------------------------------
// forge dependencies report
// ---------------------------------------------------------------------------

describe("forge dependencies report", () => {
	const rootFiles = {
		"/package.json": JSON.stringify({
			name: "ROOT",
			version: "1.0.0",
			dependencies: { axios: "^1.0.0" },
		}),
		"/projects/app/package.json": JSON.stringify({
			name: "@MOCK_ORG/MOCK_APP",
			version: "1.0.0",
			dependencies: { axios: "^1.0.0" },
			devDependencies: {},
		}),
		"/projects/app/src/index.ts": `import axios from "axios";`,
	};

	it("succeeds when dependencies are in sync", async () => {
		vol.fromJSON(rootFiles);

		const app = await RootModule.create([ForgeModule]);
		const response = await app.run(["forge", "dependencies", "report"]);

		expect(response.reportDependencies?.succeeded).toBe(true);
	});

	it("succeeds even when there is drift (reporting only, no --fail-on-drift)", async () => {
		vol.fromJSON({
			...rootFiles,
			"/projects/app/package.json": JSON.stringify({
				name: "@MOCK_ORG/MOCK_APP",
				version: "1.0.0",
				dependencies: { rxjs: "^7.0.0" }, // wrong — not imported
				devDependencies: {},
			}),
		});

		const app = await RootModule.create([ForgeModule]);
		const response = await app.run(["forge", "dependencies", "report"]);

		expect(response.reportDependencies?.succeeded).toBe(true);
	});

	it("throws when --fail-on-drift is passed and dependencies have drifted", async () => {
		vol.fromJSON({
			...rootFiles,
			"/projects/app/package.json": JSON.stringify({
				name: "@MOCK_ORG/MOCK_APP",
				version: "1.0.0",
				dependencies: { rxjs: "^7.0.0" }, // wrong — not imported
				devDependencies: {},
			}),
		});

		const app = await RootModule.create([ForgeModule]);
		await expect(
			app.run(["forge", "dependencies", "report", "--fail-on-drift"]),
		).rejects.toThrow("Dependency drift detected");
	});
});

// ---------------------------------------------------------------------------
// forge publish / version / tag (dry-run smoke tests)
// ---------------------------------------------------------------------------

describe("forge publish", () => {
	it("succeeds in dry-run mode (all-private workspace skips actual publish)", async () => {
		vol.fromJSON({
			"/package.json": JSON.stringify({ name: "ROOT", version: "1.0.0" }),
			"/projects/lib1/package.json": JSON.stringify({
				name: "lib1",
				version: "1.0.0",
				private: true,
			}),
		});

		const app = await RootModule.create([ForgeModule]);
		const response = await app.run(["forge", "publish", "--dry-run"]);
		expect(response.publish?.succeeded).toBe(true);
	});

	it("calls npm publish with expected args for a public project", async () => {
		vol.fromJSON({
			"/package.json": JSON.stringify({ name: "ROOT", version: "1.0.0" }),
			"/projects/lib1/package.json": JSON.stringify({
				name: "lib1",
				version: "1.0.0",
			}),
		});

		const publishSpy = vi
			.spyOn(Npm.prototype, "publish")
			.mockResolvedValue({ message: "published", data: [] });

		const app = await RootModule.create([ForgeModule]);
		const response = await app.run(["forge", "publish", "--dry-run"]);

		expect(response.publish?.succeeded).toBe(true);
		expect(publishSpy).toHaveBeenCalledWith("dist/release/projects/lib1", {
			skipIfPublished: true,
			dryRun: true,
			channel: "beta",
			authToken: undefined,
			otp: undefined,
		});
	});
});

describe("forge version", () => {
	it("succeeds in dry-run mode without modifying package.json", async () => {
		vol.fromJSON({
			"/package.json": JSON.stringify({ name: "ROOT", version: "1.0.0" }),
			"/projects/lib1/package.json": JSON.stringify({ name: "lib1", version: "1.0.0" }),
		});

		const app = await RootModule.create([ForgeModule]);
		const response = await app.run(["forge", "version", "--dry-run"]);

		expect(response.version?.succeeded).toBe(true);
		// Dry-run must not mutate package.json
		const pkg = await io.readJsonFile<{ version: string }>("/projects/lib1/package.json");
		expect(pkg.version).toBe("1.0.0");
	});
});

describe("forge tag", () => {
	it("succeeds in dry-run mode", async () => {
		vol.fromJSON({
			"/package.json": JSON.stringify({ name: "ROOT", version: "1.0.0" }),
			"/projects/lib1/package.json": JSON.stringify({ name: "lib1", version: "1.0.0" }),
		});

		const app = await RootModule.create([ForgeModule]);
		const response = await app.run(["forge", "tag", "--dry-run"]);
		expect(response.tag?.succeeded).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// forge build --watch
// ---------------------------------------------------------------------------

async function waitUntil(condition: () => boolean, timeoutMs = 5000): Promise<void> {
	const start = Date.now();
	while (!condition()) {
		if (Date.now() - start > timeoutMs) throw new Error("waitUntil timed out");
		await new Promise((r) => setTimeout(r, 50));
	}
}

describe("forge build --watch", () => {
	const outputPath = "/dist/debug/projects/lib1/src/index.js";
	const sourcePath = "/projects/lib1/src/index.ts";
	const projectFiles = {
		"/package.json": JSON.stringify({ name: "ROOT", version: "1.0.0" }),
		"/projects/lib1/package.json": JSON.stringify({ name: "lib1", version: "1.0.0" }),
		[sourcePath]: "export const value = 1;",
	};

	it("stays alive until SIGINT then resolves cleanly", async () => {
		vol.fromJSON(projectFiles);

		const app = await RootModule.create([ForgeModule]);
		const runPromise = app.run(["forge", "build", "--watch"]);

		// Wait for initial build output
		await waitUntil(() => fileExists(outputPath));
		expect(fileExists(outputPath)).toBe(true);

		// Trigger shutdown — unblocks RootModule.run()
		process.emit("SIGINT");

		const response = await runPromise;
		expect(response.watch?.succeeded).toBe(true);
	});

	it("performs an incremental rebuild when a source file changes", async () => {
		vol.fromJSON(projectFiles);

		const app = await RootModule.create([ForgeModule]);
		const runPromise = app.run(["forge", "build", "--watch"]);

		// Wait for initial build
		await waitUntil(() => fileExists(outputPath));

		const initialContent = fs.readFileSync(outputPath, "utf8") as string;

		// Write a changed source file — memfs watch fires the event
		fs.writeFileSync(sourcePath, "export const value = 2;");

		// Wait for incremental rebuild to update the output
		await waitUntil(
			() =>
				fileExists(outputPath) &&
				(fs.readFileSync(outputPath, "utf8") as string) !== initialContent,
		);

		const updatedContent = fs.readFileSync(outputPath, "utf8") as string;
		expect(updatedContent).not.toBe(initialContent);
		expect(updatedContent).toContain("2");

		process.emit("SIGINT");
		await runPromise;
	});
});
