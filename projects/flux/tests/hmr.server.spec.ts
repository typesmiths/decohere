/**
 * Unit: HotReloadServer edges the terminal flux CLI suite cannot see —
 * disposal, resolveProject errors, and multi-branch graph invalidation.
 *
 * Canonical flux CLI behavior lives in
 * `projects/cli/tests/flux.integration.spec.ts`.
 *
 * Fixture tree A:  main.ts -> dep-a.ts -> dep-b.ts
 * Fixture tree B:  main.ts -> dep-a.ts -> dep-b.ts
 *                         \-> dep-c.ts -> dep-d.ts
 */

import { DefaultConfigurations, WorkspaceDefaults } from "@decohere/forge";
import { PackageJson, Workspace } from "@decohere/workspace";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("fs");
vi.mock("node:fs");

import {
	formatFluxRebootReady,
	formatFluxRebootStart,
	HotReloadServer,
} from "../src/hot-reload-server.js";

const fixturesDir = new URL("./__fixtures__/hmr-ts", import.meta.url).pathname;
const mainPath = `${fixturesDir}/main.ts`;
const depAPath = `${fixturesDir}/dep-a.ts`;
const depBPath = `${fixturesDir}/dep-b.ts`;

function makeWorkspace() {
	return new Workspace({
		config: {
			...WorkspaceDefaults,
			rootDir: fixturesDir,
		},
		projects: [
			{
				name: "hmr-ts",
				config: {
					...WorkspaceDefaults,
					rootDir: fixturesDir,
					projectDir: ".",
					configurations: DefaultConfigurations,
					packageJson: new PackageJson({ main: "main.ts" }),
				},
			},
		],
	});
}

async function seedFromDisk() {
	const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
	vol.fromJSON({
		[mainPath]: realFs.readFileSync(mainPath, "utf8") as string,
		[depAPath]: realFs.readFileSync(depAPath, "utf8") as string,
		[depBPath]: realFs.readFileSync(depBPath, "utf8") as string,
	});
}

function consoleLines(spy: { mock: { calls: unknown[][] } }): string[] {
	return spy.mock.calls.map((call) => String(call[0] ?? ""));
}

function nextReboot(server: HotReloadServer, ms = 2000): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("reboot did not fire")), ms);
		server.once("reboot", () => {
			clearTimeout(timer);
			resolve();
		});
	});
}

describe("HotReloadServer", () => {
	let server: HotReloadServer;

	beforeEach(async () => {
		server = new HotReloadServer();
		await seedFromDisk();
		await server.start({ workspace: makeWorkspace(), buildConfig: "debug" });
	});

	afterEach(async () => {
		await server.dispose();
		vol.reset();
	});

	it("should call asyncDispose on the entry when the server is disposed", async () => {
		await server.dispose();
		expect(vol.existsSync("/disposed.txt")).toBe(true);
	});

	it("logs flux reboot and flux ready at info when a dependency change reboots the entry", async () => {
		const consoleSpy = vi.spyOn(console, "log");
		const reboot = nextReboot(server);
		vol.writeFileSync(depBPath, `export const value = 42;`);
		await reboot;

		const lines = consoleLines(consoleSpy);
		expect(
			lines.some((line) => {
				const lower = line.toLowerCase();
				return (
					line.includes("INFO") &&
					lower.includes("flux reboot") &&
					line.includes("hmr-ts") &&
					line.includes("dep-b.ts") &&
					line.includes("═")
				);
			}),
		).toBe(true);
		expect(
			lines.some((line) => {
				const lower = line.toLowerCase();
				return (
					line.includes("INFO") &&
					lower.includes("flux ready") &&
					line.includes("hmr-ts") &&
					/\d+ms/.test(line) &&
					line.includes("═")
				);
			}),
		).toBe(true);
		consoleSpy.mockRestore();
	});

	it("emits reboot when a watched dependency is missing", async () => {
		vol.unlinkSync(depBPath);
		const internal = server as unknown as {
			loader: { invalidateTranspile: (...paths: string[]) => void };
			runReboot: () => Promise<void>;
		};
		internal.loader.invalidateTranspile(depBPath);

		const reboot = nextReboot(server, 3000);
		await internal.runReboot();
		await reboot;
	});
});

const twoBranchDir = new URL("./__fixtures__/hmr-two-branch", import.meta.url).pathname;
const tbMainPath = `${twoBranchDir}/main.ts`;
const tbDepAPath = `${twoBranchDir}/dep-a.ts`;
const tbDepBPath = `${twoBranchDir}/dep-b.ts`;
const tbDepCPath = `${twoBranchDir}/dep-c.ts`;
const tbDepDPath = `${twoBranchDir}/dep-d.ts`;

function makeTwoBranchWorkspace() {
	return new Workspace({
		config: {
			...WorkspaceDefaults,
			rootDir: twoBranchDir,
		},
		projects: [
			{
				name: "hmr-two-branch",
				config: {
					...WorkspaceDefaults,
					rootDir: twoBranchDir,
					projectDir: ".",
					configurations: DefaultConfigurations,
					packageJson: new PackageJson({ main: "main.ts" }),
				},
			},
		],
	});
}

describe("HotReloadServer — two-branch dependency tree", () => {
	let server: HotReloadServer;

	beforeEach(async () => {
		server = new HotReloadServer();
		const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
		vol.fromJSON({
			[tbMainPath]: realFs.readFileSync(tbMainPath, "utf8") as string,
			[tbDepAPath]: realFs.readFileSync(tbDepAPath, "utf8") as string,
			[tbDepBPath]: realFs.readFileSync(tbDepBPath, "utf8") as string,
			[tbDepCPath]: realFs.readFileSync(tbDepCPath, "utf8") as string,
			[tbDepDPath]: realFs.readFileSync(tbDepDPath, "utf8") as string,
		});
		await server.start({ workspace: makeTwoBranchWorkspace(), buildConfig: "debug" });
	});

	afterEach(async () => {
		await server.dispose();
		vol.reset();
	});

	it("reboots from both branches independently after one branch triggers a reboot", async () => {
		// Branch 1: depB change → reboot
		const reboot1 = nextReboot(server);
		vol.writeFileSync(tbDepBPath, `export const aValue = 10;`);
		await reboot1;

		// Branch 2: depD change → must still reboot despite branch 1's invalidation pruning edges
		const reboot2 = nextReboot(server);
		vol.writeFileSync(tbDepDPath, `export const cValue = 20;`);
		await reboot2;
	}, 10_000);
});

describe("HotReloadServer — version tokens", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	function versionModule(server: HotReloadServer) {
		return (
			server as unknown as { versionModule: (url: string) => string }
		).versionModule.bind(server);
	}

	it("issues distinct ?version= values when Date.now is frozen", () => {
		vi.spyOn(Date, "now").mockReturnValue(1_000_000_000_000);
		const stamp = versionModule(new HotReloadServer());

		const first = stamp("file:///workspace/a.ts");
		const second = stamp("file:///workspace/a.ts");

		expect(first).not.toBe(second);
		expect(new URL(first).searchParams.get("version")).not.toBe(
			new URL(second).searchParams.get("version"),
		);
	});

	it("does not reuse ?version= across HotReloadServer instances", () => {
		const first = versionModule(new HotReloadServer())("file:///workspace/a.ts");
		const second = versionModule(new HotReloadServer())("file:///workspace/a.ts");
		expect(first).not.toBe(second);
	});
});

describe("HotReloadServer — reboot serialization", () => {
	let server: HotReloadServer;

	beforeEach(async () => {
		server = new HotReloadServer();
		const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
		vol.fromJSON({
			[mainPath]: `import { vol } from "memfs";
import { value } from "./dep-a.js";

export default {
	value,
	async [Symbol.asyncDispose]() {
		if (vol.existsSync("/disposing")) {
			vol.writeFileSync("/overlapped.txt", "1");
		}
		vol.writeFileSync("/disposing", "1");
		await new Promise((resolve) => setTimeout(resolve, 400));
		vol.unlinkSync("/disposing");
	},
};
`,
			[depAPath]: realFs.readFileSync(depAPath, "utf8") as string,
			[depBPath]: realFs.readFileSync(depBPath, "utf8") as string,
		});
		await server.start({ workspace: makeWorkspace(), buildConfig: "debug" });
	});

	afterEach(async () => {
		await server.dispose();
		vol.reset();
	});

	it("does not overlap asyncDispose when a second save arrives mid-reboot", async () => {
		const internal = server as unknown as {
			rebootTail: Promise<void>;
			runReboot: () => Promise<void>;
		};

		const reboot1 = nextReboot(server, 8000);
		internal.rebootTail = internal.rebootTail.then(
			() => internal.runReboot(),
			() => internal.runReboot(),
		);
		await new Promise((resolve) => setTimeout(resolve, 50));

		const reboot2 = nextReboot(server, 8000);
		internal.rebootTail = internal.rebootTail.then(
			() => internal.runReboot(),
			() => internal.runReboot(),
		);
		await reboot1;
		await reboot2;

		expect(vol.existsSync("/overlapped.txt")).toBe(false);
	}, 15_000);
});

describe("HotReloadServer — failed boot", () => {
	let server: HotReloadServer;

	const countingMain = `import { vol } from "memfs";
import { value } from "./dep-a.js";

vol.writeFileSync("/counting-booted", "1");

export default {
	value,
	async [Symbol.asyncDispose]() {
		const n = vol.existsSync("/dispose-count")
			? Number(vol.readFileSync("/dispose-count", "utf8"))
			: 0;
		vol.writeFileSync("/dispose-count", String(n + 1));
	},
};
`;

	beforeEach(async () => {
		server = new HotReloadServer();
		const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
		vol.fromJSON({
			[mainPath]: countingMain,
			[depAPath]: realFs.readFileSync(depAPath, "utf8") as string,
			[depBPath]: realFs.readFileSync(depBPath, "utf8") as string,
		});
		await server.start({ workspace: makeWorkspace(), buildConfig: "debug" });
	});

	afterEach(async () => {
		await server.dispose();
		vol.reset();
	});

	it("does not asyncDispose the previous entry twice after a failed boot", async () => {
		expect(vol.existsSync("/counting-booted")).toBe(true);

		const internal = server as unknown as {
			disposeEntry: () => Promise<void>;
			runReboot: () => Promise<void>;
			loader: { invalidateTranspile: (...paths: string[]) => void };
		};

		await internal.disposeEntry();
		expect(vol.readFileSync("/dispose-count", "utf8")).toBe("1");
		await internal.disposeEntry();
		expect(vol.readFileSync("/dispose-count", "utf8")).toBe("1");

		vol.writeFileSync(mainPath, `throw new Error("boot fail");\n`);
		internal.loader.invalidateTranspile(mainPath);
		const failed = nextReboot(server, 5000);
		await internal.runReboot();
		await failed;
		expect(vol.readFileSync("/dispose-count", "utf8")).toBe("1");
	}, 10_000);
});

describe("HotReloadServer — reboot debounce", () => {
	let server: HotReloadServer;

	afterEach(async () => {
		await server.dispose();
		vol.reset();
	});

	it("coalesces writes spaced over 250ms when rebootDebounceMs is larger", async () => {
		server = new HotReloadServer();
		await seedFromDisk();
		await server.start({
			workspace: makeWorkspace(),
			buildConfig: "debug",
			rebootDebounceMs: 800,
		});

		let reboots = 0;
		server.on("reboot", () => {
			reboots += 1;
		});

		vol.writeFileSync(depBPath, `export const value = 1;`);
		await new Promise((resolve) => setTimeout(resolve, 300));
		vol.writeFileSync(depBPath, `export const value = 2;`);
		await new Promise((resolve) => setTimeout(resolve, 300));
		vol.writeFileSync(depBPath, `export const value = 3;`);
		await new Promise((resolve) => setTimeout(resolve, 1100));

		expect(reboots).toBe(1);
		const mod = await import(`${depBPath}?test=debounce-window`);
		expect((mod as { value: number }).value).toBe(3);
	}, 15_000);

	it("collapses saves during an in-flight reboot to one follow-up", async () => {
		const entryWithDispose = (n: number) => `import { vol } from "memfs";
import { value } from "./dep-a.js";

export default {
	value: ${n},
	async [Symbol.asyncDispose]() {
		await new Promise((resolve) => setTimeout(resolve, 500));
	},
};
`;
		server = new HotReloadServer();
		const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
		vol.fromJSON({
			[mainPath]: entryWithDispose(0),
			[depAPath]: realFs.readFileSync(depAPath, "utf8") as string,
			[depBPath]: realFs.readFileSync(depBPath, "utf8") as string,
		});
		await server.start({
			workspace: makeWorkspace(),
			buildConfig: "debug",
			rebootDebounceMs: 80,
		});

		let reboots = 0;
		server.on("reboot", () => {
			reboots += 1;
		});

		vol.writeFileSync(mainPath, entryWithDispose(1));
		await new Promise((resolve) => setTimeout(resolve, 150));
		vol.writeFileSync(mainPath, entryWithDispose(2));
		await new Promise((resolve) => setTimeout(resolve, 120));
		vol.writeFileSync(mainPath, entryWithDispose(3));
		await new Promise((resolve) => setTimeout(resolve, 120));
		vol.writeFileSync(mainPath, entryWithDispose(4));
		await new Promise((resolve) => setTimeout(resolve, 1500));

		expect(reboots).toBe(2);
	}, 15_000);

	it("rejects a negative rebootDebounceMs", async () => {
		server = new HotReloadServer();
		await expect(
			server.start({
				workspace: makeWorkspace(),
				buildConfig: "debug",
				rebootDebounceMs: -1,
			}),
		).rejects.toThrow("rebootDebounceMs must be a non-negative number");
	});
});

describe("HotReloadServer — resolveProject", () => {
	it("throws when the workspace has no projects for the given configuration", async () => {
		const server = new HotReloadServer();
		const emptyWorkspace = new Workspace({ config: WorkspaceDefaults, projects: [] });
		await expect(
			server.start({ workspace: emptyWorkspace, buildConfig: "debug" }),
		).rejects.toThrow("No projects found for configuration: debug");
	});

	it("throws when the requested project name is not in the workspace", async () => {
		const server = new HotReloadServer();
		const workspace = makeWorkspace();
		await expect(
			server.start({ workspace, project: "nonexistent", buildConfig: "debug" }),
		).rejects.toThrow('Project "nonexistent" not found in workspace');
	});
});

describe("HotReloadServer — multiple entries", () => {
	const multiDir = new URL("./__fixtures__/hmr-multi-entry", import.meta.url).pathname;
	const multiA = `${multiDir}/api-a/main.ts`;
	const multiB = `${multiDir}/api-b/main.ts`;

	function makeMultiWorkspace() {
		return new Workspace({
			config: {
				...WorkspaceDefaults,
				rootDir: multiDir,
			},
			projects: [
				{
					name: "api-a",
					config: {
						...WorkspaceDefaults,
						rootDir: multiDir,
						projectDir: "api-a",
						configurations: DefaultConfigurations,
						packageJson: new PackageJson({ main: "main.ts" }),
					},
				},
				{
					name: "api-b",
					config: {
						...WorkspaceDefaults,
						rootDir: multiDir,
						projectDir: "api-b",
						configurations: DefaultConfigurations,
						packageJson: new PackageJson({ main: "main.ts" }),
					},
				},
			],
		});
	}

	afterEach(async () => {
		vol.reset();
	});

	it("boots every named project entry in one start()", async () => {
		const server = new HotReloadServer();
		const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
		vol.fromJSON({
			[multiA]: realFs.readFileSync(multiA, "utf8") as string,
			[multiB]: realFs.readFileSync(multiB, "utf8") as string,
		});

		await server.start({
			workspace: makeMultiWorkspace(),
			buildConfig: "debug",
			projects: ["api-a", "api-b"],
		});

		expect(vol.existsSync("/multi-a-booted")).toBe(true);
		expect(vol.existsSync("/multi-b-booted")).toBe(true);
		await server.dispose();
	});
});

describe("HotReloadServer — reboot banner on first start", () => {
	afterEach(async () => {
		vol.reset();
		vi.restoreAllMocks();
	});

	it("does not log flux reboot when the entry boots for the first time", async () => {
		const consoleSpy = vi.spyOn(console, "log");
		const server = new HotReloadServer();
		await seedFromDisk();
		await server.start({ workspace: makeWorkspace(), buildConfig: "debug" });
		const lines = consoleLines(consoleSpy);
		expect(lines.some((line) => line.toLowerCase().includes("flux reboot"))).toBe(false);
		await server.dispose();
	});
});

// The walk had no visited set (exponential on diamonds) and logged legal cycles as errors.
describe("HotReloadServer — dependency graph walk", () => {
	type Internal = {
		dependencies: Map<string, string[]>;
		loader: { setSourceFile: (path: string, project: unknown) => void };
		getDependencyGraph: (moduleId: string) => string[];
	};

	function serverWithImporters(importers: Record<string, string[]>): Internal {
		const internal = new HotReloadServer() as unknown as Internal;
		for (const [file, parents] of Object.entries(importers)) {
			internal.dependencies.set(file, parents);
			for (const p of [file, ...parents]) internal.loader.setSourceFile(p, {});
		}
		return internal;
	}

	it("walks a long chain of diamonds once per file", () => {
		// m0 is imported by a0 and b0, which are both imported by m1, and so on: 2^24 paths.
		const importers: Record<string, string[]> = {};
		const levels = 24;
		for (let i = 0; i < levels; i++) {
			importers[`/m${i}.ts`] = [`/a${i}.ts`, `/b${i}.ts`];
			importers[`/a${i}.ts`] = [`/m${i + 1}.ts`];
			importers[`/b${i}.ts`] = [`/m${i + 1}.ts`];
		}
		const internal = serverWithImporters(importers);

		const graph = internal.getDependencyGraph("/m0.ts");

		expect(graph).toHaveLength(levels * 3);
		expect(graph).toContain(`/m${levels}.ts`);
	}, 2_000);

	it("follows a legal import cycle to the entry without logging an error", () => {
		const internal = serverWithImporters({
			"/a.ts": ["/b.ts"],
			"/b.ts": ["/a.ts", "/main.ts"],
		});
		const logged: string[] = [];
		for (const method of ["log", "info", "warn", "error"] as const) {
			vi.spyOn(console, method).mockImplementation((...args) => {
				logged.push(args.join(" "));
			});
		}

		const graph = internal.getDependencyGraph("/a.ts");

		expect(new Set(graph)).toEqual(new Set(["/a.ts", "/b.ts", "/main.ts"]));
		expect(logged.join("\n")).not.toContain("ERROR");
	});
});

describe("formatFluxRebootStart / formatFluxRebootReady", () => {
	const rule = "═".repeat(56);

	it("joins project labels and trigger paths in a ruled block", () => {
		expect(formatFluxRebootStart(["hmr-ts"], ["dep-b.ts"])).toBe(
			`\n${rule}\n  FLUX REBOOT\n  hmr-ts\n  dep-b.ts\n${rule}\n`,
		);
		expect(formatFluxRebootReady(["hmr-ts"], 412)).toBe(
			`\n${rule}\n  FLUX READY\n  hmr-ts\n  412ms\n${rule}\n`,
		);
	});

	it("omits the trigger list when none were recorded", () => {
		expect(formatFluxRebootStart(["api-a", "api-b"])).toBe(
			`\n${rule}\n  FLUX REBOOT\n  api-a, api-b\n${rule}\n`,
		);
	});

	it("caps a long trigger list so the banner stays scannable", () => {
		expect(
			formatFluxRebootStart(["my-api"], ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts"]),
		).toBe(`\n${rule}\n  FLUX REBOOT\n  my-api\n  a.ts, b.ts, c.ts, d.ts, +2\n${rule}\n`);
	});
});
