import type { PackageJson } from "@decohere/workspace";
import { Project, WorkspaceFactory } from "@decohere/workspace";
import { io } from "@decohere/core/io";
import { resetMemfs } from "@decohere/testing";
import { scribe } from "@decohere/scribe";
import { vol } from "memfs";
import { beforeEach, expect, it, vi } from "vitest";
import { SyncDependencies } from "../../src/actions/dependency-sync.action.js";
import { DependencyResolver } from "../../src/services/dependency-resolver.service.js";
import { Release, WorkspaceDefaults } from "../../src/workspace.config.js";

const lib1Path = "projects/lib1";
const lib2Path = "projects/lib2";
const appPath = "projects/app1";

const mockFiles = {
	"package.json": JSON.stringify({
		dependencies: { fastify: "^5.0.0", axios: "^1.0.0", rxjs: "^7.0.0" },
		devDependencies: { vitest: "^3.0.0" },
	}),
	[`${lib1Path}/package.json`]: JSON.stringify({
		name: "@MOCK_ORG/MOCK_LIB1",
		version: "1.0.0",
		dependencies: {},
		devDependencies: {},
	}),
	[`${lib2Path}/package.json`]: JSON.stringify({
		name: "@MOCK_ORG/MOCK_LIB2",
		version: "1.0.0",
		dependencies: {},
		devDependencies: {},
	}),
};

let resolver: DependencyResolver;
beforeEach(async () => {
	resetMemfs();
	resolver = new DependencyResolver();
});

it("should return a result per project", async () => {
	vol.fromJSON({
		...mockFiles,
		[`${appPath}/package.json`]: JSON.stringify({
			name: "@MOCK_ORG/MOCK_APP1",
			version: "1.0.0",
			dependencies: {},
			devDependencies: {},
		}),
		[`${appPath}/index.ts`]: `import axios from "axios";`,
	});

	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const action = new SyncDependencies(workspace, resolver);
	const response = await action.run({ configuration: Release.name });

	expect(response.data).toHaveLength(3);
});

it("should write resolved dependencies to each project package.json", async () => {
	vol.fromJSON({
		...mockFiles,
		[`${appPath}/package.json`]: JSON.stringify({
			name: "@MOCK_ORG/MOCK_APP1",
			version: "1.0.0",
			dependencies: { rxjs: "^7.0.0" },
			devDependencies: {},
		}),
		[`${appPath}/index.ts`]: `import axios from "axios";`,
	});

	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const action = new SyncDependencies(workspace, resolver);
	await action.run({ configuration: Release.name });

	const written = (await io.readJsonFile(`${appPath}/package.json`)) as PackageJson;
	expect(written.dependencies).toEqual({ axios: "^1.0.0" });
});

it("should not write any project when a package is missing", async () => {
	vol.fromJSON({
		...mockFiles,
		[`${appPath}/package.json`]: JSON.stringify({
			name: "@MOCK_ORG/MOCK_APP1",
			version: "1.0.0",
			dependencies: {},
			devDependencies: {},
		}),
		[`${appPath}/index.ts`]: [
			`import * from "UNINSTALLED_PACKAGE"`,
			`import axios from "axios";`,
		].join("\n"),
	});

	const persistPackageJson = vi.spyOn(Project.prototype, "persistPackageJson");
	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const action = new SyncDependencies(workspace, resolver);
	const response = await action.run({ configuration: Release.name });

	expect(response.succeeded).toBe(false);
	expect(persistPackageJson).not.toHaveBeenCalled();
});

it("should report the error message from the failed project", async () => {
	vol.fromJSON({
		...mockFiles,
		[`${appPath}/package.json`]: JSON.stringify({
			name: "@MOCK_ORG/MOCK_APP1",
			version: "1.0.0",
			dependencies: {},
			devDependencies: {},
		}),
		[`${appPath}/index.ts`]: `import * from "UNINSTALLED_PACKAGE"`,
	});

	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const action = new SyncDependencies(workspace, resolver);
	const response = await action.run({ configuration: Release.name });

	expect(response.succeeded).toBe(false);
	expect(response.message).toBe(
		'@MOCK_ORG/MOCK_APP1: Missing packages in project "@MOCK_ORG/MOCK_APP1": UNINSTALLED_PACKAGE',
	);
});

it("should include drift in the result when sync changes dependencies", async () => {
	vol.fromJSON({
		...mockFiles,
		[`${appPath}/package.json`]: JSON.stringify({
			name: "@MOCK_ORG/MOCK_APP1",
			version: "1.0.0",
			dependencies: { rxjs: "^7.0.0" }, // declared but not imported
			devDependencies: {},
		}),
		[`${appPath}/index.ts`]: `import axios from "axios";`, // imports axios, not rxjs
	});

	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const action = new SyncDependencies(workspace, resolver);
	const response = await action.run({ configuration: Release.name });

	expect(response.succeeded).toBe(true);
	const app = response.data.find((r) => r.projectName === "@MOCK_ORG/MOCK_APP1");
	expect(app?.drift).toMatchObject({
		original: { dependencies: { rxjs: "^7.0.0" } },
		updated: { dependencies: { axios: "^1.0.0" } },
	});
});

it("should include null drift in the result when deps already match", async () => {
	vol.fromJSON({
		...mockFiles,
		[`${appPath}/package.json`]: JSON.stringify({
			name: "@MOCK_ORG/MOCK_APP1",
			version: "1.0.0",
			dependencies: { axios: "^1.0.0" },
			devDependencies: {},
		}),
		[`${appPath}/index.ts`]: `import axios from "axios";`,
	});

	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const action = new SyncDependencies(workspace, resolver);
	const response = await action.run({ configuration: Release.name });

	expect(response.succeeded).toBe(true);
	const app = response.data.find((r) => r.projectName === "@MOCK_ORG/MOCK_APP1");
	expect(app?.drift).toBeNull();
});

it("should log diff per project when logDiff is true and dependencies changed", async () => {
	vol.fromJSON({
		...mockFiles,
		[`${appPath}/package.json`]: JSON.stringify({
			name: "@MOCK_ORG/MOCK_APP1",
			version: "1.0.0",
			dependencies: { rxjs: "^7.0.0" },
			devDependencies: {},
		}),
		[`${appPath}/index.ts`]: `import axios from "axios";`,
	});

	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const mockLogger = { warn: vi.fn(), info: vi.fn(), trace: vi.fn(), error: vi.fn() };
	vi.spyOn(scribe, "logger").mockReturnValue(mockLogger as never);
	const action = new SyncDependencies(workspace, resolver);

	await action.run({ configuration: Release.name, logDiff: true });

	expect(mockLogger.warn).toHaveBeenCalledWith(
		expect.stringContaining("@MOCK_ORG/MOCK_APP1"),
		expect.objectContaining({
			original: expect.objectContaining({ dependencies: { rxjs: "^7.0.0" } }),
			updated: expect.objectContaining({ dependencies: { axios: "^1.0.0" } }),
		}),
	);
});

it("should not log diff when logDiff is false", async () => {
	vol.fromJSON({
		...mockFiles,
		[`${appPath}/package.json`]: JSON.stringify({
			name: "@MOCK_ORG/MOCK_APP1",
			version: "1.0.0",
			dependencies: { rxjs: "^7.0.0" },
			devDependencies: {},
		}),
		[`${appPath}/index.ts`]: `import axios from "axios";`,
	});

	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const mockLogger = { warn: vi.fn(), info: vi.fn(), trace: vi.fn(), error: vi.fn() };
	vi.spyOn(scribe, "logger").mockReturnValue(mockLogger as never);
	const action = new SyncDependencies(workspace, resolver);

	await action.run({ configuration: Release.name });

	expect(mockLogger.warn).not.toHaveBeenCalledWith(
		expect.stringContaining("@MOCK_ORG/MOCK_APP1"),
		expect.anything(),
	);
});

it("should not include vitest as a dependency when it is only imported in spec files", async () => {
	vol.fromJSON({
		...mockFiles,
		[`${appPath}/package.json`]: JSON.stringify({
			name: "@MOCK_ORG/MOCK_APP1",
			version: "1.0.0",
			dependencies: {},
			devDependencies: {},
		}),
		[`${appPath}/index.ts`]: `import axios from "axios";`,
		[`${appPath}/index.spec.ts`]: `import { describe, it } from "vitest";`,
	});

	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const action = new SyncDependencies(workspace, resolver);
	await action.run({ configuration: Release.name });

	const written = (await io.readJsonFile(`${appPath}/package.json`)) as PackageJson;
	expect(written.dependencies).not.toHaveProperty("vitest");
	expect(written.devDependencies).not.toHaveProperty("vitest");
});

it("should not include vitest when imported in a non-spec helper inside tests/", async () => {
	vol.fromJSON({
		...mockFiles,
		[`${appPath}/package.json`]: JSON.stringify({
			name: "@MOCK_ORG/MOCK_APP1",
			version: "1.0.0",
			dependencies: {},
			devDependencies: {},
		}),
		[`${appPath}/index.ts`]: `import axios from "axios";`,
		[`${appPath}/tests/helpers.ts`]: `import { vi } from "vitest";`,
	});

	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const action = new SyncDependencies(workspace, resolver);
	await action.run({ configuration: Release.name });

	const written = (await io.readJsonFile(`${appPath}/package.json`)) as PackageJson;
	expect(written.dependencies).not.toHaveProperty("vitest");
	expect(written.devDependencies).not.toHaveProperty("vitest");
});

it("should throw when the root package.json is missing", async () => {
	vol.fromJSON({
		"projects/app/package.json": JSON.stringify({
			name: "@MOCK_ORG/MOCK_APP",
			version: "1.0.0",
			dependencies: {},
			devDependencies: {},
		}),
		"projects/app/index.ts": `import axios from "axios";`,
	});

	const workspace = await WorkspaceFactory.create(WorkspaceDefaults);
	const action = new SyncDependencies(workspace, resolver);

	await expect(action.run({ configuration: "release" })).rejects.toThrow(
		"Root package.json not found",
	);
});
