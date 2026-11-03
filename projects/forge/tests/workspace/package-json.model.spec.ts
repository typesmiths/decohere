import { PackageJson } from "@decohere/workspace";
import { expect, it } from "vitest";

it("should sort dependency keys alphabetically when serialized", () => {
	const pkg = new PackageJson({
		name: "test",
		dependencies: { zod: "^3.0.0", axios: "^1.0.0", fastify: "^5.0.0" },
		devDependencies: {},
	});

	const parsed = JSON.parse(pkg.toJSON());
	expect(Object.keys(parsed.dependencies)).toEqual(["axios", "fastify", "zod"]);
});

it("should sort devDependency keys alphabetically when serialized", () => {
	const pkg = new PackageJson({
		name: "test",
		dependencies: {},
		devDependencies: { vitest: "^3.0.0", eslint: "^9.0.0", prettier: "^3.0.0" },
	});

	const parsed = JSON.parse(pkg.toJSON());
	expect(Object.keys(parsed.devDependencies)).toEqual(["eslint", "prettier", "vitest"]);
});
