import fs from "node:fs";
import { PackageJson, Project, type UiConfig, type Workspace } from "@decohere/workspace";
import { Npm } from "@decohere/devkit/interop";
import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PackageDeployable } from "../../src/actions/package.action.js";
import { DependencyPinner } from "../../src/packaging/dependency-pinner.service.js";
import { ImportGraph } from "../../src/packaging/import-graph.service.js";
import { Release } from "../../src/workspace.config.js";

const manifests: Record<string, Record<string, unknown>> = {
	"@app/api": { name: "@app/api", version: "2.0.0", main: "src/main.ts" },
	"@app/worker": { name: "@app/worker", version: "2.0.0", main: "src/main.ts" },
	"@app/web": { name: "@app/web", version: "1.0.0" },
	"@app/kernel": {
		name: "@app/kernel",
		version: "1.5.0",
		main: "src/index.ts",
		exports: { ".": "./src/index.ts" },
		dependencies: { ms: "^2.0.0" },
	},
};
const directories: Record<string, string> = {
	"@app/api": "api",
	"@app/worker": "worker",
	"@app/web": "web",
	"@app/kernel": "kernel",
};

/** The `ui` declaration of @app/api in `.decohere.js`; each test sets what it needs. */
let apiUi: UiConfig | undefined;

function projects(): Project[] {
	return Object.entries(manifests).map(([name, manifest]) => {
		return new Project(
			name,
			{
				projectDir: `projects/${directories[name]}`,
				rootDir: "/ws",
				outDir: "dist",
				packageJson: new PackageJson(manifest),
				configurations: [Release],
				ui: name === "@app/api" ? apiUi : undefined,
			} as never,
			Release.name,
		);
	});
}

function workspace(): Workspace {
	return {
		rootDir: "/ws",
		getProjects: vi.fn(() => projects()),
		getPackageJson: vi.fn(async () => new PackageJson({ name: "root", version: "1.0.0" })),
	} as unknown as Workspace;
}

function seed(files: Record<string, string> = {}) {
	vol.fromJSON({
		"/ws/package.json": JSON.stringify({ name: "root", version: "1.0.0" }),
		"/ws/config/config.yaml": "port: 3000",
		"/ws/node_modules/ms/package.json": JSON.stringify({ name: "ms", version: "2.1.3" }),
		...Object.fromEntries(
			Object.entries(manifests).map(([name, manifest]) => [
				`/ws/projects/${directories[name]}/package.json`,
				JSON.stringify(manifest),
			]),
		),
		"/ws/projects/api/Dockerfile": "FROM node",
		"/ws/projects/worker/Dockerfile": "FROM node",
		"/ws/dist/release/projects/api/es6/src/main.js": `import { v } from "@app/kernel";\nimport "./util.js";`,
		"/ws/dist/release/projects/api/es6/src/util.js": `export const u = 1;`,
		"/ws/dist/release/projects/worker/es6/src/main.js": `console.log("worker");`,
		"/ws/dist/release/projects/kernel/es6/src/index.js": `import ms from "ms";\nexport const v = ms;`,
		...files,
	});
}

function action() {
	return new PackageDeployable(workspace(), new ImportGraph(), new DependencyPinner());
}

beforeEach(() => {
	vi.spyOn(Npm.prototype, "installProduction").mockImplementation(async () => {
		fs.mkdirSync("/ws/projects/api/.package/node_modules/ms", { recursive: true });
		fs.writeFileSync("/ws/projects/api/.package/node_modules/ms/package.json", "{}");
		return { message: "installed", data: [] };
	});
});

afterEach(() => {
	apiUi = undefined;
	resetMemfs();
	vi.restoreAllMocks();
});

describe("PackageDeployable", () => {
	it("writes package.json, es6, config and the reached libraries into .package", async () => {
		seed();

		const response = await action().run({ project: "@app/api" });

		expect(response.succeeded).toBe(true);
		const manifest = JSON.parse(
			fs.readFileSync("/ws/projects/api/.package/package.json", "utf8"),
		);
		expect(manifest).toMatchObject({
			name: "app-api",
			version: "2.0.0",
			private: true,
			type: "module",
			scripts: { start: "node es6/src/main.js" },
			dependencies: { ms: "2.1.3" },
		});
		expect(fs.existsSync("/ws/projects/api/.package/es6/src/util.js")).toBe(true);
		expect(fs.readFileSync("/ws/projects/api/.package/config/config.yaml", "utf8")).toBe(
			"port: 3000",
		);
		const library = JSON.parse(
			fs.readFileSync(
				"/ws/projects/api/.package/node_modules/@app/kernel/package.json",
				"utf8",
			),
		);
		expect(library).toEqual({
			name: "@app/kernel",
			version: "1.5.0",
			type: "module",
			exports: { ".": "./es6/src/index.js" },
		});
		expect(
			fs.existsSync("/ws/projects/api/.package/node_modules/@app/kernel/es6/src/index.js"),
		).toBe(true);
	});

	it("installs before copying libraries, with a clean output folder", async () => {
		seed({ "/ws/projects/api/.package/stale.txt": "left over" });

		await action().run({ project: "@app/api" });

		expect(fs.existsSync("/ws/projects/api/.package/stale.txt")).toBe(false);
		expect(Npm.prototype.installProduction).toHaveBeenCalledWith({
			cwd: "/ws/projects/api/.package",
		});
	});

	it("skips npm when the deployable reaches no third-party package", async () => {
		seed();

		const response = await action().run({ project: "@app/worker" });

		expect(response.succeeded).toBe(true);
		expect(Npm.prototype.installProduction).not.toHaveBeenCalled();
		expect(fs.existsSync("/ws/projects/worker/.package/es6/src/main.js")).toBe(true);
	});

	it("packages every project with a Dockerfile when none is named, and never a library", async () => {
		seed();

		const response = await action().run({});

		expect(response.data.map((entry) => entry.projectName)).toEqual([
			"@app/api",
			"@app/worker",
		]);
		expect(fs.existsSync("/ws/projects/kernel/.package")).toBe(false);
	});

	it("refuses a library with a message that says why", async () => {
		seed();

		const response = await action().run({ project: "@app/kernel" });

		expect(response.succeeded).toBe(false);
		expect(response.message).toBe(
			"@app/kernel has no Dockerfile, so it is a library, not a deployable. " +
				"Libraries are packaged into the deployables that import them.",
		);
		expect(fs.existsSync("/ws/projects/kernel/.package")).toBe(false);
	});

	it("refuses a project name the workspace does not have", async () => {
		seed();

		const response = await action().run({ project: "@app/nope" });

		expect(response.succeeded).toBe(false);
		expect(response.message).toContain("@app/nope is not a workspace project");
	});

	it("honours docker.dockerfile from the project's configuration", async () => {
		seed();
		vi.spyOn(Project.prototype, "dockerConfig", "get").mockReturnValue({
			dockerfile: "Dockerfile.prod",
		});

		const response = await action().run({ project: "@app/api" });

		expect(response.succeeded).toBe(false);
		expect(response.message).toContain("has no Dockerfile.prod");
	});

	it("tells the user to build first when there is no release output", async () => {
		seed();
		vol.rmSync("/ws/dist", { recursive: true });

		const response = await action().run({ project: "@app/api" });

		expect(response.succeeded).toBe(false);
		expect(response.message).toContain("forge build --configuration release");
	});

	it("leaves nothing behind but a failure when a reached package is only a devDependency", async () => {
		manifests["@app/kernel"] = {
			...manifests["@app/kernel"],
			dependencies: {},
			devDependencies: { ms: "^2.0.0" },
		};
		try {
			seed();

			const response = await action().run({ project: "@app/api" });

			expect(response.succeeded).toBe(false);
			expect(response.message).toContain("only a devDependency");
			expect(fs.existsSync("/ws/projects/api/.package")).toBe(false);
		} finally {
			manifests["@app/kernel"] = {
				name: "@app/kernel",
				version: "1.5.0",
				main: "src/index.ts",
				exports: { ".": "./src/index.ts" },
				dependencies: { ms: "^2.0.0" },
			};
		}
	});

	describe("with a declared UI project", () => {
		const built = {
			"/ws/projects/web/dist/index.html": "<html></html>",
			"/ws/projects/web/dist/assets/index-3f9a8c1b.js": "console.log(1)",
		};

		it("copies the UI build into .package/ui and leaves the API output as it was", async () => {
			apiUi = { project: "@app/web" };
			seed(built);

			const response = await action().run({ project: "@app/api" });

			expect(response.succeeded).toBe(true);
			expect(fs.readFileSync("/ws/projects/api/.package/ui/index.html", "utf8")).toBe(
				"<html></html>",
			);
			expect(fs.existsSync("/ws/projects/api/.package/ui/assets/index-3f9a8c1b.js")).toBe(
				true,
			);
			expect(fs.existsSync("/ws/projects/api/.package/es6/src/main.js")).toBe(true);
		});

		it("honours the output folder and the target folder", async () => {
			apiUi = { project: "@app/web", output: "build/client", to: "public/app" };
			seed({ "/ws/projects/web/build/client/index.html": "custom" });

			const response = await action().run({ project: "@app/api" });

			expect(response.succeeded).toBe(true);
			expect(fs.readFileSync("/ws/projects/api/.package/public/app/index.html", "utf8")).toBe(
				"custom",
			);
		});

		it("follows a symlink in the UI build and writes a real file", async () => {
			apiUi = { project: "@app/web" };
			seed({ ...built, "/ws/projects/web/real/logo.svg": "<svg/>" });
			fs.symlinkSync("/ws/projects/web/real/logo.svg", "/ws/projects/web/dist/logo.svg");

			const response = await action().run({ project: "@app/api" });

			expect(response.succeeded).toBe(true);
			const copied = "/ws/projects/api/.package/ui/logo.svg";
			expect(fs.lstatSync(copied).isSymbolicLink()).toBe(false);
			expect(fs.readFileSync(copied, "utf8")).toBe("<svg/>");
		});

		it("tells the user to build the UI first, and leaves the previous package alone", async () => {
			apiUi = { project: "@app/web" };
			seed({ "/ws/projects/api/.package/previous.txt": "last good package" });

			const response = await action().run({ project: "@app/api" });

			expect(response.succeeded).toBe(false);
			expect(response.message).toContain("@app/web");
			expect(response.message).toContain("Build the UI first");
			expect(fs.readFileSync("/ws/projects/api/.package/previous.txt", "utf8")).toBe(
				"last good package",
			);
		});

		it("names the known projects when the UI project does not exist", async () => {
			apiUi = { project: "@app/nope" };
			seed();

			const response = await action().run({ project: "@app/api" });

			expect(response.succeeded).toBe(false);
			expect(response.message).toContain("@app/nope, which is not a workspace project");
		});

		it.each(["../escape", "/abs", "es6", "node_modules/x", "."])(
			"refuses ui.to %s",
			async (to) => {
				apiUi = { project: "@app/web", to };
				seed(built);

				const response = await action().run({ project: "@app/api" });

				expect(response.succeeded).toBe(false);
				expect(response.message).toContain("ui.to");
			},
		);

		it("refuses a ui.output that leaves the UI project", async () => {
			apiUi = { project: "@app/web", output: "../api" };
			seed(built);

			const response = await action().run({ project: "@app/api" });

			expect(response.succeeded).toBe(false);
			expect(response.message).toContain("ui.output");
		});
	});

	describe("config files", () => {
		const packaged = () =>
			fs.existsSync("/ws/projects/api/.package/config")
				? (fs.readdirSync("/ws/projects/api/.package/config") as string[]).sort()
				: [];
		const allConfig = {
			"/ws/config/config.dev.yaml": "a: 1",
			"/ws/config/config.production.yaml": "a: 1",
			"/ws/config/config.staging.yaml": "a: 1",
			"/ws/config/config.api.yaml": "a: 1",
			"/ws/config/config.api.production.yaml": "a: 1",
			"/ws/config/config.api.dev.yaml": "a: 1",
			"/ws/config/config.billing.yaml": "a: 1",
			"/ws/config/config.billing.production.yaml": "a: 1",
		};

		it("copies only what this app reads in production, by default", async () => {
			seed(allConfig);

			const response = await action().run({ project: "@app/api" });

			expect(response.succeeded).toBe(true);
			expect(packaged()).toEqual([
				"config.api.production.yaml",
				"config.api.yaml",
				"config.production.yaml",
				"config.yaml",
			]);
		});

		it("takes the environments and apps it's given", async () => {
			seed(allConfig);

			await action().run({
				project: "@app/api",
				env: ["staging", "dev"],
				app: ["billing"],
			});

			expect(packaged()).toEqual([
				"config.billing.yaml",
				"config.dev.yaml",
				"config.staging.yaml",
				"config.yaml",
			]);
		});

		it("is fine when an env's file doesn't exist", async () => {
			seed();

			const response = await action().run({ project: "@app/api", env: ["staging"] });

			expect(response.succeeded).toBe(true);
			expect(packaged()).toEqual(["config.yaml"]);
		});

		it("keeps folders, which the loader doesn't layer", async () => {
			seed({ "/ws/config/automation/rules.yaml": "a: 1" });

			await action().run({ project: "@app/api" });

			expect(
				fs.readFileSync("/ws/projects/api/.package/config/automation/rules.yaml", "utf8"),
			).toBe("a: 1");
		});

		it.each(["settings.json", "config.yml", "config.a.b.c.yaml", "secrets.yaml"])(
			"stops on %s, which fits no pattern, naming it",
			async (name) => {
				seed({ [`/ws/config/${name}`]: "a: 1" });

				const response = await action().run({ project: "@app/api" });

				expect(response.succeeded).toBe(false);
				expect(response.message).toContain(name);
			},
		);

		it("refuses an app named like an environment", async () => {
			seed();

			const response = await action().run({ project: "@app/api", app: ["production"] });

			expect(response.succeeded).toBe(false);
			expect(response.message).toContain("both an app and an environment");
		});

		it("refuses a name that can't be part of a file name", async () => {
			seed();

			const response = await action().run({ project: "@app/api", env: ["../secrets"] });

			expect(response.succeeded).toBe(false);
			expect(response.message).toContain("can't name a config file");
		});
	});
});
