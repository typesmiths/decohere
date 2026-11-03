import { PackageJson, WorkspaceFactory } from "@decohere/workspace";
import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { beforeEach, expect, it } from "vitest";
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

it("should resolve dependencies imported in project files", async () => {
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
	const packages = await resolver.getWorkspacePackages(
		workspace,
		workspace.getProjects("debug"),
	);
	const app = workspace
		.getProjects(Release.name)
		.find((p) => p.name === "@MOCK_ORG/MOCK_APP1")!;

	const { updatedPackage } = await resolver.computeProjectDependencies(app, packages);

	expect(updatedPackage.dependencies).toEqual({ axios: "^1.0.0" });
	expect(updatedPackage.devDependencies).toEqual({});
});

it("should resolve dev dependencies under a configuration that doesn't publish", async () => {
	vol.fromJSON({
		...mockFiles,
		[`${appPath}/package.json`]: JSON.stringify({
			name: "@MOCK_ORG/MOCK_APP1",
			version: "1.0.0",
			dependencies: {},
			devDependencies: {},
		}),
		[`${appPath}/index.ts`]: `import { describe } from "vitest";`,
	});

	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const packages = await resolver.getWorkspacePackages(
		workspace,
		workspace.getProjects("debug"),
	);
	const app = workspace.getProjects("debug").find((p) => p.name === "@MOCK_ORG/MOCK_APP1")!;

	const { updatedPackage } = await resolver.computeProjectDependencies(app, packages);

	expect(updatedPackage.dependencies).toEqual({});
	expect(updatedPackage.devDependencies).toEqual({ vitest: "^3.0.0" });
});

// Peer dependencies

async function releaseApp(pkg: Record<string, unknown>, source: string) {
	vol.fromJSON({
		...mockFiles,
		[`${appPath}/package.json`]: JSON.stringify({
			name: "@MOCK_ORG/MOCK_APP1",
			version: "1.0.0",
			dependencies: {},
			devDependencies: {},
			...pkg,
		}),
		[`${appPath}/src/index.ts`]: source,
		[`${appPath}/tests/index.spec.ts`]: `import { it } from "vitest";`,
	});
	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const packages = await resolver.getWorkspacePackages(
		workspace,
		workspace.getProjects("debug"),
	);
	const app = workspace
		.getProjects(Release.name)
		.find((p) => p.name === "@MOCK_ORG/MOCK_APP1")!;
	return { app, packages };
}

it("writes a declared peer with the root's version and keeps it out of dependencies", async () => {
	const { app, packages } = await releaseApp(
		{
			peerDependencies: { vitest: "*" },
			peerDependenciesMeta: { vitest: { optional: true } },
		},
		`import { vi } from "vitest";\nimport axios from "axios";`,
	);

	const { updatedPackage } = await resolver.computeProjectDependencies(app, packages);

	expect(updatedPackage.peerDependencies).toEqual({ vitest: "^3.0.0" });
	expect(updatedPackage.dependencies).toEqual({ axios: "^1.0.0" });
	expect(updatedPackage.devDependencies).toEqual({});
	expect(updatedPackage).toMatchObject({
		peerDependenciesMeta: { vitest: { optional: true } },
	});
});

it("keeps a declared peer that no code imports, such as a transport loaded by name", async () => {
	const { app, packages } = await releaseApp(
		{ peerDependencies: { rxjs: "^6.0.0" } },
		`import axios from "axios";`,
	);

	const { updatedPackage } = await resolver.computeProjectDependencies(app, packages);

	expect(updatedPackage.peerDependencies).toEqual({ rxjs: "^7.0.0" });
	expect(updatedPackage.dependencies).toEqual({ axios: "^1.0.0" });
});

it("fails when a declared peer is not in the root package.json", async () => {
	const { app, packages } = await releaseApp(
		{ peerDependencies: { "left-pad": "^1.0.0" } },
		`import axios from "axios";`,
	);

	await expect(resolver.computeProjectDependencies(app, packages)).rejects.toThrow(
		/"left-pad".*peer.*root package\.json/,
	);
});

it("fails when shipped code imports a root devDependency that isn't a declared peer", async () => {
	const { app, packages } = await releaseApp({}, `import { vi } from "vitest";`);

	await expect(resolver.computeProjectDependencies(app, packages)).rejects.toThrow(
		/devDependency.*vitest, imported by src\/index\.ts.*peerDependencies/s,
	);
});

it("should resolve cross-library internal dependencies", async () => {
	vol.fromJSON({
		...mockFiles,
		[`${appPath}/package.json`]: JSON.stringify({
			name: "@MOCK_ORG/MOCK_APP1",
			version: "1.0.0",
			dependencies: {},
			devDependencies: {},
		}),
		[`${appPath}/index.ts`]: [
			`import { LIB1 } from "@MOCK_ORG/MOCK_LIB1";`,
			`import fastify from "fastify";`,
			`import axios from "axios";`,
		].join("\n"),
	});

	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const packages = await resolver.getWorkspacePackages(
		workspace,
		workspace.getProjects("debug"),
	);
	const app = workspace
		.getProjects(Release.name)
		.find((p) => p.name === "@MOCK_ORG/MOCK_APP1")!;

	const { updatedPackage } = await resolver.computeProjectDependencies(app, packages);

	expect(updatedPackage.dependencies).toEqual({
		"@MOCK_ORG/MOCK_LIB1": "1.0.0",
		fastify: "^5.0.0",
		axios: "^1.0.0",
	});
});

it("should exclude imports not present in the workspace", async () => {
	vol.fromJSON({
		...mockFiles,
		[`${appPath}/package.json`]: JSON.stringify({
			name: "@MOCK_ORG/MOCK_APP1",
			version: "1.0.0",
			dependencies: {},
			devDependencies: {},
		}),
		[`${appPath}/index.ts`]: [`import * from "UNINSTALLED_PACKAGE"`].join("\n"),
	});

	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const packages = await resolver.getWorkspacePackages(
		workspace,
		workspace.getProjects("debug"),
	);
	const app = workspace
		.getProjects(Release.name)
		.find((p) => p.name === "@MOCK_ORG/MOCK_APP1")!;

	await expect(resolver.computeProjectDependencies(app, packages)).rejects.toThrow(
		'Missing packages in project "@MOCK_ORG/MOCK_APP1": UNINSTALLED_PACKAGE',
	);
});

it("should drop unused dependencies that are no longer imported", async () => {
	vol.fromJSON({
		...mockFiles,
		[`${appPath}/package.json`]: JSON.stringify({
			name: "@MOCK_ORG/MOCK_APP1",
			version: "1.0.0",
			dependencies: { MOCK_UNUSED: "1.0.0", axios: "^1.0.0" },
			devDependencies: {},
		}),
		[`${appPath}/index.ts`]: `import axios from "axios";`,
	});

	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const packages = await resolver.getWorkspacePackages(
		workspace,
		workspace.getProjects("debug"),
	);
	const app = workspace
		.getProjects(Release.name)
		.find((p) => p.name === "@MOCK_ORG/MOCK_APP1")!;

	const { updatedPackage } = await resolver.computeProjectDependencies(app, packages);

	expect(updatedPackage.dependencies).toEqual({ axios: "^1.0.0" });
	expect(updatedPackage.dependencies).not.toHaveProperty("MOCK_UNUSED");
});

it("should resolve dependencies imported in a sibling file re-exported from index", async () => {
	vol.fromJSON({
		...mockFiles,
		[`${appPath}/package.json`]: JSON.stringify({
			name: "@MOCK_ORG/MOCK_APP1",
			version: "1.0.0",
			dependencies: {},
			devDependencies: {},
		}),
		// index only re-exports from a sibling file; the actual import is in the sibling
		[`${appPath}/index.ts`]: `export { handler } from "./handler.js";`,
		[`${appPath}/handler.ts`]: `import axios from "axios";`,
	});

	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const packages = await resolver.getWorkspacePackages(
		workspace,
		workspace.getProjects("debug"),
	);
	const app = workspace
		.getProjects(Release.name)
		.find((p) => p.name === "@MOCK_ORG/MOCK_APP1")!;

	const { updatedPackage } = await resolver.computeProjectDependencies(app, packages);

	expect(updatedPackage.dependencies).toEqual({ axios: "^1.0.0" });
});

it("should return a warning for dynamic imports with non-literal specifiers", async () => {
	vol.fromJSON({
		...mockFiles,
		[`${appPath}/package.json`]: JSON.stringify({
			name: "@MOCK_ORG/MOCK_APP1",
			version: "1.0.0",
			dependencies: {},
			devDependencies: {},
		}),
		// depName is a variable — parse-imports cannot statically resolve the specifier
		[`${appPath}/index.ts`]: [`const depName = "axios";`, `await import(depName);`].join("\n"),
	});

	const workspace = await WorkspaceFactory.create({ ...WorkspaceDefaults, rootDir: "." });
	const packages = await resolver.getWorkspacePackages(
		workspace,
		workspace.getProjects("debug"),
	);
	const app = workspace
		.getProjects(Release.name)
		.find((p) => p.name === "@MOCK_ORG/MOCK_APP1")!;

	const { updatedPackage, warnings } = await resolver.computeProjectDependencies(
		app,
		packages,
	);

	// The dynamic import is unresolvable statically — it should not appear as a dependency
	// and should not throw as a missing package
	expect(updatedPackage.dependencies).toEqual({});
	expect(warnings).toHaveLength(1);
	expect(warnings[0]).toMatchObject({
		file: expect.stringContaining("index.ts"),
		line: 2,
		message: expect.stringContaining("non-literal specifier"),
	});
});

// computeDrift

it("computeDrift returns null when current and computed deps match", () => {
	const pkg = new PackageJson({
		dependencies: { axios: "^1.0.0" },
		devDependencies: { vitest: "^3.0.0" },
	});
	expect(resolver.computeDrift(pkg, pkg)).toBeNull();
});

it("computeDrift returns drift when a package is added", () => {
	const current = new PackageJson({ dependencies: {}, devDependencies: {} });
	const computed = new PackageJson({ dependencies: { axios: "^1.0.0" }, devDependencies: {} });

	const drift = resolver.computeDrift(current, computed);

	expect(drift).toMatchObject({
		original: { dependencies: {} },
		updated: { dependencies: { axios: "^1.0.0" } },
	});
});

it("computeDrift returns drift when a package is removed", () => {
	const current = new PackageJson({ dependencies: { axios: "^1.0.0" }, devDependencies: {} });
	const computed = new PackageJson({ dependencies: {}, devDependencies: {} });

	const drift = resolver.computeDrift(current, computed);

	expect(drift).toMatchObject({
		original: { dependencies: { axios: "^1.0.0" } },
		updated: { dependencies: {} },
	});
});

it("computeDrift returns drift when a peer's version changes", () => {
	const current = new PackageJson({ peerDependencies: { vitest: "^3.0.0" } });
	const computed = new PackageJson({ peerDependencies: { vitest: "^3.2.0" } });

	const drift = resolver.computeDrift(current, computed);

	expect(drift).toMatchObject({
		original: { peerDependencies: { vitest: "^3.0.0" } },
		updated: { peerDependencies: { vitest: "^3.2.0" } },
	});
});

it("computeDrift returns drift when a package version changes", () => {
	const current = new PackageJson({ dependencies: { axios: "^1.0.0" }, devDependencies: {} });
	const computed = new PackageJson({ dependencies: { axios: "^2.0.0" }, devDependencies: {} });

	const drift = resolver.computeDrift(current, computed);

	expect(drift).toMatchObject({
		original: { dependencies: { axios: "^1.0.0" } },
		updated: { dependencies: { axios: "^2.0.0" } },
	});
});
