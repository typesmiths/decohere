import path from "node:path";
import { fileURLToPath } from "node:url";
import { FluxModule, HotReloadServer } from "@decohere/flux";
import { Caching } from "@decohere/core/caching";
import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { realFs } from "../../../vitest.setup.js";
import { RootModule } from "../src/root.module.js";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "__fixtures__/hmr");
const packageJsonPath = path.join(fixtureDir, "projects/app/package.json");
const mainPath = path.join(fixtureDir, "projects/app/main.ts");
const depAPath = path.join(fixtureDir, "projects/app/dep-a.ts");
const depBPath = path.join(fixtureDir, "projects/app/dep-b.ts");

const pkgFixtureDir = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"__fixtures__/hmr-packages",
);
const pkgAppMainPath = path.join(pkgFixtureDir, "projects/app/main.ts");
const pkgAppPackageJsonPath = path.join(pkgFixtureDir, "projects/app/package.json");
const pkgLibIndexPath = path.join(pkgFixtureDir, "projects/lib/src/index.ts");
const pkgLibPackageJsonPath = path.join(pkgFixtureDir, "projects/lib/package.json");

const appWithFooAndBarImport = `import { vol } from "memfs";
import { foo, bar } from "@hmr/lib";

vol.writeFileSync("/observed.json", JSON.stringify({ foo, bar }));

export default {
	async [Symbol.asyncDispose]() {},
};
`;

let appModule: Awaited<ReturnType<typeof RootModule.create>>;
let emitSpy: MockInstance;
let serverInstance: HotReloadServer;
let serverReady: Promise<void>;
let sigintReady: Promise<void>;

async function mockProcessAndCaptureServer() {
	vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

	let resolveSigint: () => void;
	sigintReady = new Promise<void>((r) => {
		resolveSigint = r;
	});
	const originalProcessOnce = process.once.bind(process);
	vi.spyOn(process, "once").mockImplementation((event: string, ...args: unknown[]) => {
		if (event === "SIGINT") resolveSigint();
		return (originalProcessOnce as (...a: unknown[]) => NodeJS.Process)(event, ...args);
	});

	emitSpy = vi.spyOn(HotReloadServer.prototype, "emit");

	let resolveServerReady: () => void;
	serverReady = new Promise<void>((r) => {
		resolveServerReady = r;
	});

	const originalStart = HotReloadServer.prototype.start;
	vi.spyOn(HotReloadServer.prototype, "start").mockImplementation(async function (
		this: HotReloadServer,
		...args
	) {
		// oxlint-disable-next-line typescript/no-this-alias -- the test needs the instance the mock was called on
		serverInstance = this;
		this.once("start", resolveServerReady);
		return originalStart.apply(this, args);
	});

	appModule = await RootModule.create([FluxModule]);
}

function readObserved(): Record<string, unknown> {
	return JSON.parse(vol.readFileSync("/observed.json", "utf8") as string);
}

afterEach(() => {
	resetMemfs();
	Caching.flushAllCaches();
	vi.restoreAllMocks();
	vi.resetModules();
});

async function stopServer(runPromise: Promise<unknown>) {
	await sigintReady;
	process.emit("SIGINT");
	await runPromise;
}

function waitForReboot(ms = 5000): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("reboot timed out")), ms);
		serverInstance.once("reboot", () => {
			clearTimeout(timer);
			resolve();
		});
	});
}

describe("flux serve", () => {
	beforeEach(async () => {
		vi.spyOn(process, "cwd").mockReturnValue(fixtureDir);
		vol.fromJSON({
			[packageJsonPath]: realFs.readFileSync(packageJsonPath, "utf8") as string,
			[mainPath]: realFs.readFileSync(mainPath, "utf8") as string,
			[depAPath]: realFs.readFileSync(depAPath, "utf8") as string,
			[depBPath]: realFs.readFileSync(depBPath, "utf8") as string,
		});
		await mockProcessAndCaptureServer();
	});

	it("boots the entry point of the first project", async () => {
		const boot = vi.fn();
		vi.doMock(`file://${mainPath}?version=1`, () => {
			boot();
			return { default: { async [Symbol.asyncDispose]() {} } };
		});

		const runPromise = appModule.run(["flux", "serve"]);
		await serverReady;
		await stopServer(runPromise);

		expect(boot).toHaveBeenCalledOnce();
	}, 10_000);

	it("reloads a direct dependency and serves updated content", async () => {
		const runPromise = appModule.run(["flux", "serve"]);
		await serverReady;

		const reboot = waitForReboot();
		vol.writeFileSync(
			depAPath,
			`export { value } from "./dep-b.js"; export const tag = "v2";`,
		);
		await reboot;

		const mod = await import(`${depAPath}?test=reload-direct`);
		expect((mod as Record<string, unknown>).tag).toBe("v2");

		await stopServer(runPromise);
	}, 10_000);

	it("reloads a grandchild dependency and serves updated content", async () => {
		const runPromise = appModule.run(["flux", "serve"]);
		await serverReady;

		const reboot = waitForReboot();
		vol.writeFileSync(depBPath, `export const value = 99;`);
		await reboot;

		const mod = await import(`${depBPath}?test=reload-grandchild`);
		expect((mod as Record<string, unknown>).value).toBe(99);

		await stopServer(runPromise);
	}, 10_000);

	it("logs flux reboot and flux ready at info when a change reboots the entry", async () => {
		const runPromise = appModule.run(["flux", "serve"]);
		await serverReady;

		const consoleSpy = vi.spyOn(console, "log");
		const reboot = waitForReboot();
		vol.writeFileSync(depBPath, `export const value = 64;`);
		await reboot;

		const lines = consoleSpy.mock.calls.map((call) => String(call[0] ?? ""));
		expect(
			lines.some((line) => {
				const lower = line.toLowerCase();
				return (
					line.includes("INFO") &&
					lower.includes("flux reboot") &&
					line.includes("my-app") &&
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
					line.includes("my-app") &&
					/\d+ms/.test(line) &&
					line.includes("═")
				);
			}),
		).toBe(true);

		await stopServer(runPromise);
	}, 10_000);

	it("reboots when a deleted file is re-added with new content", async () => {
		const runPromise = appModule.run(["flux", "serve"]);
		await serverReady;

		const reboot = waitForReboot();
		vol.unlinkSync(depBPath);
		vol.writeFileSync(depBPath, `export const value = 77;`);
		await reboot;

		const mod = await import(`${depBPath}?test=re-added`);
		expect((mod as Record<string, unknown>).value).toBe(77);

		await stopServer(runPromise);
	}, 10_000);

	it("continues running after a transpile error and serves the fixed version", async () => {
		const runPromise = appModule.run(["flux", "serve"]);
		await serverReady;

		const reboot1 = waitForReboot();
		vol.writeFileSync(depAPath, `export const value = THIS IS NOT VALID TS !!!`);
		await reboot1;
		const reboot2 = waitForReboot();
		vol.writeFileSync(depAPath, `export const tag = "fixed";`);
		await reboot2;

		const mod = await import(`${depAPath}?test=transpile-error`);
		expect((mod as Record<string, unknown>).tag).toBe("fixed");

		await stopServer(runPromise);
	}, 15_000);

	it("coalesces spaced saves inside --reboot-debounce-ms", async () => {
		const runPromise = appModule.run(["flux", "serve", "--reboot-debounce-ms", "800"]);
		await serverReady;

		let reboots = 0;
		serverInstance.on("reboot", () => {
			reboots += 1;
		});

		vol.writeFileSync(depBPath, `export const value = 1;`);
		await new Promise((resolve) => setTimeout(resolve, 300));
		vol.writeFileSync(depBPath, `export const value = 2;`);
		await new Promise((resolve) => setTimeout(resolve, 300));
		vol.writeFileSync(depBPath, `export const value = 3;`);
		await new Promise((resolve) => setTimeout(resolve, 1100));

		expect(reboots).toBe(1);
		const mod = await import(`${depBPath}?test=debounce-cli`);
		expect((mod as { value: number }).value).toBe(3);

		await stopServer(runPromise);
	}, 15_000);

	it("resets --reboot-debounce-ms from the last affecting save in a multi-file train", async () => {
		const debounceMs = 1000;
		const gapMs = 400;
		const runPromise = appModule.run([
			"flux",
			"serve",
			"--reboot-debounce-ms",
			String(debounceMs),
		]);
		await serverReady;

		let reboots = 0;
		let rebootAt = 0;
		serverInstance.on("reboot", () => {
			reboots += 1;
			rebootAt = Date.now();
		});

		const firstWriteAt = Date.now();
		vol.writeFileSync(depBPath, `export const value = 1;`);
		await new Promise((resolve) => setTimeout(resolve, gapMs));
		vol.writeFileSync(depAPath, `export { value } from "./dep-b.js";\n`);
		await new Promise((resolve) => setTimeout(resolve, gapMs));
		const lastWriteAt = Date.now();
		vol.writeFileSync(depBPath, `export const value = 3;`);

		await waitForReboot(debounceMs + gapMs * 2 + 3000);

		expect(reboots).toBe(1);
		// Trailing debounce must arm from the last save, not the first.
		expect(rebootAt).toBeGreaterThanOrEqual(lastWriteAt + debounceMs - 200);
		expect(rebootAt).toBeGreaterThan(firstWriteAt + debounceMs + gapMs);

		const mod = await import(`${depBPath}?test=debounce-reset`);
		expect((mod as { value: number }).value).toBe(3);

		await stopServer(runPromise);
	}, 20_000);

	it("should not ghost-reboot when a module is removed from the dependency graph after a reload", async () => {
		const runPromise = appModule.run(["flux", "serve"]);
		await serverReady;

		// Remove dep-b from dep-a's imports — triggers reboot
		const reboot = waitForReboot();
		vol.writeFileSync(depAPath, `export const value = 0;`);
		await reboot;

		// dep-b is no longer imported — changing it must not reboot
		emitSpy.mockClear();
		vol.writeFileSync(depBPath, `export const value = 42;`);
		await new Promise((resolve) => setTimeout(resolve, 500));
		expect(emitSpy).not.toHaveBeenCalledWith("reboot");

		await stopServer(runPromise);
	}, 10_000);

	it("should not infinitely recurse and should still reboot when a circular dependency is detected", async () => {
		const runPromise = appModule.run(["flux", "serve"]);
		await serverReady;

		// Inject a back-edge into the live server instance
		const deps = (serverInstance as unknown as { dependencies: Map<string, string[]> })
			.dependencies;
		deps.set(depBPath, [...(deps.get(depBPath) ?? []), depAPath]);

		const reboot = waitForReboot();
		vol.writeFileSync(depBPath, `export const value = 99;`);
		await reboot;

		await stopServer(runPromise);
	}, 10_000);

	it("should reboot when dep-b is re-added after being removed and re-referenced out of order", async () => {
		const runPromise = appModule.run(["flux", "serve"]);
		await serverReady;

		// Step 1: delete dep-b — graph preserved
		vol.unlinkSync(depBPath);

		// Step 2: update dep-a to remove dep-b reference — triggers reboot
		const reboot1 = waitForReboot();
		vol.writeFileSync(depAPath, `export const value = 0;`);
		await reboot1;

		// Step 3: update dep-a to re-add dep-b reference — triggers reboot
		const reboot2 = waitForReboot();
		vol.writeFileSync(depAPath, `export { value } from "./dep-b.js";`);
		await reboot2;

		// Step 4: add dep-b back — graph has dep-b -> dep-a -> main, reboot expected
		const reboot3 = waitForReboot();
		vol.writeFileSync(depBPath, `export const value = 99;`);
		await reboot3;

		const mod = await import(`${depBPath}?test=re-added-out-of-order`);
		expect((mod as Record<string, unknown>).value).toBe(99);

		await stopServer(runPromise);
	}, 20_000);
});

describe("flux serve — workspace package aliases", () => {
	beforeEach(async () => {
		vi.spyOn(process, "cwd").mockReturnValue(pkgFixtureDir);
		vol.fromJSON({
			[pkgAppPackageJsonPath]: realFs.readFileSync(pkgAppPackageJsonPath, "utf8") as string,
			[pkgAppMainPath]: realFs.readFileSync(pkgAppMainPath, "utf8") as string,
			[pkgLibPackageJsonPath]: realFs.readFileSync(pkgLibPackageJsonPath, "utf8") as string,
			[pkgLibIndexPath]: realFs.readFileSync(pkgLibIndexPath, "utf8") as string,
		});
		await mockProcessAndCaptureServer();
	});

	it("reloads a workspace package via convention aliases without node_modules links", async () => {
		const runPromise = appModule.run(["flux", "serve", "--project", "hmr-app"]);
		await serverReady;
		expect(readObserved()).toEqual({ foo: 1 });

		const reboot = waitForReboot();
		vol.writeFileSync(pkgLibIndexPath, `export const foo = 99;\n`);
		await reboot;
		await vi.waitFor(() => {
			expect(readObserved()).toEqual({ foo: 99 });
		});

		await stopServer(runPromise);
	}, 10_000);

	it("serves a named export added to a workspace package after in-process reboot", async () => {
		const runPromise = appModule.run(["flux", "serve", "--project", "hmr-app"]);
		await serverReady;
		expect(readObserved()).toEqual({ foo: 1 });

		const rebootLib = waitForReboot();
		vol.writeFileSync(pkgLibIndexPath, `export const foo = 1;\nexport const bar = 2;\n`);
		await rebootLib;

		const rebootApp = waitForReboot();
		vol.writeFileSync(pkgAppMainPath, appWithFooAndBarImport);
		await rebootApp;
		await vi.waitFor(() => {
			expect(readObserved()).toEqual({ foo: 1, bar: 2 });
		});

		await stopServer(runPromise);
	}, 15_000);

	it("recovers when the importer is saved before the workspace package export exists", async () => {
		const runPromise = appModule.run(["flux", "serve", "--project", "hmr-app"]);
		await serverReady;
		expect(readObserved()).toEqual({ foo: 1 });

		const failedBoot = waitForReboot();
		vol.writeFileSync(pkgAppMainPath, appWithFooAndBarImport);
		await failedBoot;
		expect(readObserved()).toEqual({ foo: 1 });

		const recovered = waitForReboot();
		vol.writeFileSync(pkgLibIndexPath, `export const foo = 1;\nexport const bar = 2;\n`);
		await recovered;
		await vi.waitFor(() => {
			expect(readObserved()).toEqual({ foo: 1, bar: 2 });
		});

		await stopServer(runPromise);
	}, 15_000);

	it("reloads a workspace package imported via dynamic import()", async () => {
		const runPromise = appModule.run(["flux", "serve", "--project", "hmr-app"]);
		await serverReady;
		expect(readObserved()).toEqual({ foo: 1 });

		const rebootToDynamic = waitForReboot();
		vol.writeFileSync(
			pkgAppMainPath,
			`import { vol } from "memfs";
const { foo } = await import("@hmr/lib");
vol.writeFileSync("/observed.json", JSON.stringify({ foo }));
export default { async [Symbol.asyncDispose]() {} };
`,
		);
		await rebootToDynamic;
		await vi.waitFor(() => {
			expect(readObserved()).toEqual({ foo: 1 });
		});

		const rebootLib = waitForReboot();
		vol.writeFileSync(pkgLibIndexPath, `export const foo = 99;\n`);
		await rebootLib;
		await vi.waitFor(() => {
			expect(readObserved()).toEqual({ foo: 99 });
		});

		await stopServer(runPromise);
	}, 15_000);
});

describe("flux serve — directory slice", () => {
	const sliceDir = path.join(
		path.dirname(fileURLToPath(import.meta.url)),
		"__fixtures__/hmr-slice",
	);
	const sliceFiles = {
		apiPkg: path.join(sliceDir, "projects/mod/api/package.json"),
		apiMain: path.join(sliceDir, "projects/mod/api/src/main.ts"),
		svcPkg: path.join(sliceDir, "projects/mod/svc/package.json"),
		svcMain: path.join(sliceDir, "projects/mod/svc/src/main.ts"),
		domainPkg: path.join(sliceDir, "projects/mod/domain/package.json"),
		domainMain: path.join(sliceDir, "projects/mod/domain/src/index.ts"),
		webPkg: path.join(sliceDir, "projects/mod/web/package.json"),
		webMain: path.join(sliceDir, "projects/mod/web/src/main.ts"),
		webScript: path.join(sliceDir, "projects/mod/web/write-marker.mjs"),
		rootPkg: path.join(sliceDir, "package.json"),
	};
	const webMarker = path.join(sliceDir, "projects/mod/web/deferred.marker");

	beforeEach(async () => {
		vi.spyOn(process, "cwd").mockReturnValue(sliceDir);
		vol.fromJSON({
			[sliceFiles.rootPkg]: realFs.readFileSync(sliceFiles.rootPkg, "utf8") as string,
			[sliceFiles.apiPkg]: realFs.readFileSync(sliceFiles.apiPkg, "utf8") as string,
			[sliceFiles.apiMain]: realFs.readFileSync(sliceFiles.apiMain, "utf8") as string,
			[sliceFiles.svcPkg]: realFs.readFileSync(sliceFiles.svcPkg, "utf8") as string,
			[sliceFiles.svcMain]: realFs.readFileSync(sliceFiles.svcMain, "utf8") as string,
			[sliceFiles.domainPkg]: realFs.readFileSync(sliceFiles.domainPkg, "utf8") as string,
			[sliceFiles.domainMain]: realFs.readFileSync(sliceFiles.domainMain, "utf8") as string,
			[sliceFiles.webPkg]: realFs.readFileSync(sliceFiles.webPkg, "utf8") as string,
			[sliceFiles.webMain]: realFs.readFileSync(sliceFiles.webMain, "utf8") as string,
			[sliceFiles.webScript]: realFs.readFileSync(sliceFiles.webScript, "utf8") as string,
		});
		try {
			realFs.unlinkSync(webMarker);
		} catch {
			/* absent */
		}
		await mockProcessAndCaptureServer();
	});

	afterEach(() => {
		try {
			realFs.unlinkSync(webMarker);
		} catch {
			/* absent */
		}
	});

	it("boots Flux apps in the slice, skips the library, and defers UI to package scripts", async () => {
		const runPromise = appModule.run(["flux", "serve", "mod"]);
		await serverReady;

		expect(vol.existsSync("/slice-api-booted")).toBe(true);
		expect(vol.existsSync("/slice-svc-booted")).toBe(true);
		await vi.waitFor(() => {
			expect(realFs.existsSync(webMarker)).toBe(true);
		});

		await stopServer(runPromise);
	}, 20_000);

	it("rejects combining slices with --project", async () => {
		await expect(
			appModule.run(["flux", "serve", "mod", "--project", "slice-api"]),
		).rejects.toThrow(/either directory slices or --project/);
	}, 10_000);
});

describe("flux run", () => {
	const runEntryPath = path.join(fixtureDir, "projects/app/run-cli.ts");

	beforeEach(async () => {
		vi.spyOn(process, "cwd").mockReturnValue(fixtureDir);
		vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
		vol.fromJSON({
			[packageJsonPath]: realFs.readFileSync(packageJsonPath, "utf8") as string,
			[mainPath]: realFs.readFileSync(mainPath, "utf8") as string,
			[depAPath]: realFs.readFileSync(depAPath, "utf8") as string,
			[depBPath]: realFs.readFileSync(depBPath, "utf8") as string,
			[runEntryPath]: realFs.readFileSync(runEntryPath, "utf8") as string,
		});
		appModule = await RootModule.create([FluxModule]);
	});

	it("compiles the entry on the fly and rewrites argv for bin-style CLIs", async () => {
		await appModule.run(["flux", "run", runEntryPath, "hello", "world"]);

		const observed = JSON.parse(vol.readFileSync("/flux-run.json", "utf8") as string) as {
			value: number;
			argv: string[];
		};
		expect(observed.value).toBe(1);
		expect(observed.argv).toEqual(["hello", "world"]);
	}, 15_000);
});
