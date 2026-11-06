import { PackageJson } from "@decohere/workspace";
import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { afterEach, describe, expect, it } from "vitest";
import { DependencyPinner } from "../../src/packaging/dependency-pinner.service.js";
import type { ReleaseProject } from "../../src/packaging/import-graph.service.js";

afterEach(() => {
	resetMemfs();
});

function project(name: string, dir: string, manifest: Record<string, unknown> = {}) {
	return {
		name,
		pkg: new PackageJson({ name, version: "1.0.0", ...manifest }),
		projectRoot: `/ws/projects/${dir}`,
		releaseDir: `/ws/dist/release/projects/${dir}`,
	} satisfies ReleaseProject;
}

function installed(location: string, name: string, version: string) {
	vol.fromJSON({
		[`${location}/node_modules/${name}/package.json`]: JSON.stringify({ name, version }),
	});
}

const root = (manifest: Record<string, unknown> = {}) => ({
	dir: "/ws",
	pkg: new PackageJson({ name: "root", version: "1.0.0", ...manifest }),
});

const none = new Map<string, Set<string>>();
const importedBy = (name: string, ...owners: string[]) => new Map([[name, new Set(owners)]]);

function pin(
	imported: Map<string, Set<string>>,
	shipped: ReleaseProject[],
	workspaceRoot = root(),
	others: ReleaseProject[] = [],
) {
	const projects = new Map([...shipped, ...others].map((p) => [p.name, p]));
	return new DependencyPinner().pin(imported, shipped, projects, workspaceRoot);
}

describe("DependencyPinner", () => {
	it("ships a package declared in the root dependencies even when nothing imports it", async () => {
		const api = project("@app/api", "api");
		installed("/ws", "pino-roll", "4.0.0");

		const pinned = await pin(none, [api], root({ dependencies: { "pino-roll": "^4.0.0" } }));

		expect(pinned).toEqual({ "pino-roll": "4.0.0" });
	});

	it("ships the dependencies a copied library declares, and the deployable's own", async () => {
		const api = project("@app/api", "api", { dependencies: { pino: "^9.0.0" } });
		const kernel = project("@app/kernel", "kernel", { dependencies: { ms: "^2.0.0" } });
		installed("/ws", "ms", "2.1.3");
		installed("/ws", "pino", "9.1.0");

		const pinned = await pin(none, [api, kernel]);

		expect(pinned).toEqual({ ms: "2.1.3", pino: "9.1.0" });
	});

	it("does not ship what only an unreached library declares", async () => {
		const api = project("@app/api", "api");
		const unused = project("@app/unused", "unused", { dependencies: { typeorm: "^0.3.0" } });
		installed("/ws", "typeorm", "0.3.20");

		const pinned = await pin(none, [api], root(), [unused]);

		expect(pinned).toEqual({});
	});

	it("never ships devDependencies, imported or not", async () => {
		const api = project("@app/api", "api", { devDependencies: { vitest: "^3.0.0" } });
		installed("/ws", "vitest", "3.0.0");

		const pinned = await pin(none, [api], root({ devDependencies: { oxlint: "^1.0.0" } }));

		expect(pinned).toEqual({});
	});

	it("does not try to install a workspace library listed in dependencies", async () => {
		const api = project("@app/api", "api", { dependencies: { "@app/kernel": "workspace:*" } });
		const kernel = project("@app/kernel", "kernel");

		const pinned = await pin(none, [api, kernel]);

		expect(pinned).toEqual({});
	});

	it("prefers the version installed beside the project that declares it", async () => {
		const kernel = project("@app/kernel", "kernel", { dependencies: { ms: "^1.0.0" } });
		installed("/ws", "ms", "2.1.3");
		installed("/ws/projects/kernel", "ms", "1.0.1");

		expect(await pin(none, [kernel])).toEqual({ ms: "1.0.1" });
	});

	it("fails when code imports a package that is only a devDependency", async () => {
		const kernel = project("@app/kernel", "kernel", { devDependencies: { vitest: "^3.0.0" } });
		installed("/ws", "vitest", "3.0.0");

		await expect(pin(importedBy("vitest", "@app/kernel"), [kernel])).rejects.toThrow(
			"vitest is imported at run time by @app/kernel, but it is only a devDependency",
		);
	});

	it("fails when code imports a package declared nowhere", async () => {
		const api = project("@app/api", "api");
		installed("/ws", "left-pad", "1.3.0");

		await expect(pin(importedBy("left-pad", "@app/api"), [api])).rejects.toThrow(
			"left-pad is imported at run time by @app/api, but is not in",
		);
	});

	it("fails when a declared package is not installed", async () => {
		const api = project("@app/api", "api", { dependencies: { ms: "^2.0.0" } });

		await expect(pin(none, [api])).rejects.toThrow(
			"ms is declared by @app/api but is not installed",
		);
	});

	it("fails when the declarers resolve different versions", async () => {
		const a = project("@app/a", "a", { dependencies: { ms: "^1.0.0" } });
		const b = project("@app/b", "b", { dependencies: { ms: "^2.0.0" } });
		installed("/ws/projects/a", "ms", "1.0.1");
		installed("/ws/projects/b", "ms", "2.1.3");

		await expect(pin(none, [a, b])).rejects.toThrow("ms is installed at different versions");
	});
});
