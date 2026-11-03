import { WorkspaceFactory } from "@decohere/workspace";
import { io } from "@decohere/core/io";
import { resetMemfs } from "@decohere/testing";
import { scribe } from "@decohere/scribe";
import { vol } from "memfs";
import { beforeEach, expect, it, vi } from "vitest";
import { ReportDependencies } from "../../src/actions/dependency-report.action.js";
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
	[`${appPath}/package.json`]: JSON.stringify({
		name: "@MOCK_ORG/MOCK_APP1",
		version: "1.0.0",
		dependencies: {},
		devDependencies: {},
	}),
	[`${appPath}/index.ts`]: `import axios from "axios";`,
};

let resolver: DependencyResolver;
beforeEach(async () => {
	resetMemfs();
	resolver = new DependencyResolver();
});

it("should return a result per project", async () => {
	vol.fromJSON(mockFiles);

	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const action = new ReportDependencies(workspace, resolver);
	const response = await action.run({ configuration: Release.name });

	expect(response.data).toHaveLength(3);
	expect(response.succeeded).toBe(true);
});

it("should log resolved dependencies for each project", async () => {
	vol.fromJSON(mockFiles);

	const info = vi.fn();
	vi.spyOn(scribe, "logger").mockReturnValue({ info } as never);

	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const action = new ReportDependencies(workspace, resolver);
	await action.run({ configuration: Release.name });

	const logged = info.mock.calls.flat().join(" ");
	expect(logged).toContain("@MOCK_ORG/MOCK_APP1");
	expect(logged).toContain("axios");
});

it("should write report to file when --file option is provided", async () => {
	vol.fromJSON(mockFiles);

	const reportFile = "/reports/output/dependency-report.txt";
	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const action = new ReportDependencies(workspace, resolver);
	await action.run({ configuration: Release.name, file: reportFile });

	const written = await io.readFile(reportFile);
	expect(written).toContain("@MOCK_ORG/MOCK_APP1");
	expect(written).toContain("axios");
});

it("should not write a file when --file option is not provided", async () => {
	vol.fromJSON(mockFiles);

	const writeFile = vi.spyOn(io, "writeFile");
	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const action = new ReportDependencies(workspace, resolver);
	await action.run({ configuration: Release.name });

	expect(writeFile).not.toHaveBeenCalled();
});

it("should return a failure when a package is missing", async () => {
	vol.fromJSON({
		...mockFiles,
		[`${appPath}/index.ts`]: `import * from "UNINSTALLED_PACKAGE"`,
	});

	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const action = new ReportDependencies(workspace, resolver);
	const response = await action.run({ configuration: Release.name });

	expect(response.succeeded).toBe(false);
});

it("should log structured drift detail per project when failOnDrift is enabled", async () => {
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

	const warn = vi.fn();
	vi.spyOn(scribe, "logger").mockReturnValue({ info: vi.fn(), warn } as never);

	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const action = new ReportDependencies(workspace, resolver);
	const response = await action.run({ configuration: Release.name, failOnDrift: true });

	expect(response.succeeded).toBe(false);
	expect(warn).toHaveBeenCalledWith(
		"Dependency drift in '@MOCK_ORG/MOCK_APP1'",
		expect.objectContaining({
			original: expect.objectContaining({ dependencies: { rxjs: "^7.0.0" } }),
			updated: expect.objectContaining({ dependencies: { axios: "^1.0.0" } }),
		}),
	);
});

it("should return a failure when failOnDrift is true and computed deps differ from declared", async () => {
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
	const action = new ReportDependencies(workspace, resolver);
	const response = await action.run({ configuration: Release.name, failOnDrift: true });

	expect(response.succeeded).toBe(false);
});
