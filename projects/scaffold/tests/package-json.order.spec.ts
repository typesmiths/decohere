import { describe, expect, it } from "vitest";
import { PackageJson, sortStringMap } from "../src/models/package-json.model.js";
import { ApiPackageJson } from "../src/webapi/models/api-package-json.model.js";

describe("sortStringMap", () => {
	it("orders keys A→Z", () => {
		expect(Object.keys(sortStringMap({ zebra: "1", alpha: "2", "@scope/pkg": "3" }))).toEqual([
			"@scope/pkg",
			"alpha",
			"zebra",
		]);
	});
});

describe("PackageJson dependency order", () => {
	it("renders dependencies and devDependencies sorted regardless of add order", () => {
		const pkg = new PackageJson("demo.api", { apiNames: ["api"], workspaceName: "demo" });
		pkg.addDependency("typeorm", "^0.3.28");
		pkg.addDependency("@casl/ability", "^6.8.1");
		pkg.addDependency("@decohere/data", "0.0.1");
		pkg.addDevDependency("vitest", "^3.2.4");
		pkg.addDevDependency("@biomejs/biome", "^2.0.0");

		const rendered = JSON.parse(pkg.files()[0]!.content) as {
			dependencies: Record<string, string>;
			devDependencies: Record<string, string>;
		};

		expect(Object.keys(rendered.dependencies)).toEqual(
			Object.keys(rendered.dependencies).sort((a, b) => a.localeCompare(b, "en")),
		);
		expect(Object.keys(rendered.devDependencies)).toEqual(
			Object.keys(rendered.devDependencies).sort((a, b) => a.localeCompare(b, "en")),
		);
		expect(Object.keys(rendered.dependencies).indexOf("@casl/ability")).toBeLessThan(
			Object.keys(rendered.dependencies).indexOf("typeorm"),
		);
	});
});

describe("ApiPackageJson dependency order", () => {
	it("renders dependencies sorted regardless of add order", () => {
		const pkg = new ApiPackageJson("demo", "api");
		pkg.addDependency("@decohere/data-typeorm", "0.0.1");
		pkg.addDependency("@casl/ability", "^6.8.1");
		pkg.addDependency("@decohere/data", "0.0.1");

		const rendered = JSON.parse(pkg.files()[0]!.content) as {
			dependencies: Record<string, string>;
		};
		expect(Object.keys(rendered.dependencies)).toEqual([
			"@casl/ability",
			"@decohere/crucible",
			"@decohere/data",
			"@decohere/data-typeorm",
			"@decohere/http",
		]);
	});
});
