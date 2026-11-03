import { PackageJson } from "@decohere/workspace";
import { describe, expect, it } from "vitest";

describe("PackageJson repository parsing", () => {
	it("parses github shorthand repository", () => {
		const packageJson = new PackageJson({
			name: "workspace",
			version: "1.2.3",
			repository: "github:typesmiths/decohere",
		});

		expect(packageJson.getRepositoryOwner()).toBe("typesmiths");
		expect(packageJson.getRepositoryName()).toBe("decohere");
		expect(packageJson.getRepositoryFullName()).toBe("typesmiths/decohere");
	});

	it("parses git+https GitHub repository URL object", () => {
		const packageJson = new PackageJson({
			name: "workspace",
			version: "1.2.3",
			repository: {
				type: "git",
				url: "git+https://github.com/typesmiths/decohere.git",
			},
		});

		expect(packageJson.getRepositoryOwner()).toBe("typesmiths");
		expect(packageJson.getRepositoryName()).toBe("decohere");
		expect(packageJson.getRepositoryFullName()).toBe("typesmiths/decohere");
	});

	it("normalizes owner and repository name to lowercase", () => {
		const packageJson = new PackageJson({
			name: "workspace",
			version: "1.2.3",
			repository: "github:TypeSmiths/DecoHere",
		});

		expect(packageJson.getRepositoryOwner()).toBe("typesmiths");
		expect(packageJson.getRepositoryName()).toBe("decohere");
		expect(packageJson.getRepositoryFullName()).toBe("typesmiths/decohere");
	});

	it("parses non-GitHub repository URL values", () => {
		const packageJson = new PackageJson({
			name: "workspace",
			version: "1.2.3",
			repository: "https://gitlab.com/typesmiths/decohere.git",
		});

		expect(packageJson.getRepositoryOwner()).toBe("typesmiths");
		expect(packageJson.getRepositoryName()).toBe("decohere");
		expect(packageJson.getRepositoryFullName()).toBe("typesmiths/decohere");
	});

	it("parses SSH repository URL values", () => {
		const packageJson = new PackageJson({
			name: "workspace",
			version: "1.2.3",
			repository: "git@gitlab.com:typesmiths/decohere.git",
		});

		expect(packageJson.getRepositoryOwner()).toBe("typesmiths");
		expect(packageJson.getRepositoryName()).toBe("decohere");
		expect(packageJson.getRepositoryFullName()).toBe("typesmiths/decohere");
	});

	it("returns undefined when repository is missing", () => {
		const packageJson = new PackageJson({
			name: "workspace",
			version: "1.2.3",
		});

		expect(packageJson.getRepositoryOwner()).toBeUndefined();
		expect(packageJson.getRepositoryName()).toBeUndefined();
		expect(packageJson.getRepositoryFullName()).toBeUndefined();
	});
});
