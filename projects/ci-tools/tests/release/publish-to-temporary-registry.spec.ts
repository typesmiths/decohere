import { vol } from "memfs";
import { beforeEach, describe, expect, it } from "vitest";
import { findPublicPackages } from "../../src/release/publish-to-temporary-registry.mjs";

describe("findPublicPackages", () => {
	beforeEach(() => {
		vol.reset();
		vol.fromJSON({
			"/build/projects/core/package.json": JSON.stringify({ name: "@decohere/core" }),
			"/build/projects/data/data/package.json": JSON.stringify({ name: "@decohere/data" }),
			"/build/projects/devcontainer/package.json": JSON.stringify({
				name: "@decohere/devcontainer",
				private: true,
			}),
			"/build/projects/core/es6/package.json": JSON.stringify({ type: "module" }),
			"/build/projects/core/node_modules/@decohere/http/package.json": JSON.stringify({
				name: "@decohere/http",
			}),
		});
	});

	it("finds public packages at any depth, and skips private ones and installed dependencies", () => {
		expect(findPublicPackages("/build").sort()).toEqual([
			"/build/projects/core",
			"/build/projects/data/data",
		]);
	});
});
