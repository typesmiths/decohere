import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const fs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { join } = await vi.importActual<typeof import("node:path")>("node:path");

type Manifest = { name?: string; dependencies?: Record<string, string> };

/**
 * The manifests npm installs from, by package name: `forge dependencies sync` writes each from
 * what its shipped code imports, and CI fails when one drifts from that.
 */
function readWorkspaceManifests(): Map<string, Manifest> {
	const manifests = new Map<string, Manifest>();
	const walk = (dir: string) => {
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!["node_modules", "dist", "__fixtures__"].includes(entry.name)) walk(path);
			} else if (entry.name === "package.json") {
				const manifest: Manifest = JSON.parse(fs.readFileSync(path, "utf8"));
				if (manifest.name != null) manifests.set(manifest.name, manifest);
			}
		}
	};
	walk(fileURLToPath(new URL("../../", import.meta.url)));
	return manifests;
}

/** Every package installing `name` brings in, through the workspace's own packages. */
function findInstalled(name: string, manifests: Map<string, Manifest>): Set<string> {
	const installed = new Set<string>();
	const visit = (packageName: string) => {
		for (const dependency of Object.keys(manifests.get(packageName)?.dependencies ?? {})) {
			if (installed.has(dependency)) continue;
			installed.add(dependency);
			visit(dependency);
		}
	};
	visit(name);
	return installed;
}

const isFastify = (name: string) => name === "fastify" || name.startsWith("@fastify/");

describe("installing @decohere/http", () => {
	const manifests = readWorkspaceManifests();

	it("installs no Fastify, at any depth: the provider is its own package", () => {
		const installed = [...findInstalled("@decohere/http", manifests)];

		expect(installed).toContain("@decohere/core");
		expect(installed.filter(isFastify)).toEqual([]);
		expect(installed).not.toContain("@decohere/http-fastify");
	});

	it("is what @decohere/http-fastify brings Fastify in for", () => {
		expect([...findInstalled("@decohere/http-fastify", manifests)]).toEqual(
			expect.arrayContaining(["@decohere/http", "fastify", "@fastify/static"]),
		);
	});
});
