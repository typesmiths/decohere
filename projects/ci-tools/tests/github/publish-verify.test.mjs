import { vol } from "memfs";
import { afterEach, describe, expect, it } from "vitest";
import {
	collectPublishVerify,
	formatGithubOutput,
	listPublishablePackages,
	parseGhcrRepository,
} from "../../src/github/publish-verify.mjs";

function seedWorkspace() {
	const root = "/workspace";
	vol.fromJSON({
		[`${root}/package.json`]: JSON.stringify({ version: "0.0.1-dev.79" }),
		[`${root}/projects/cli/package.json`]: JSON.stringify({
			name: "@decohere/cli",
			version: "0.0.1-dev.79",
		}),
		[`${root}/projects/scaffold/package.json`]: JSON.stringify({
			name: "@decohere/scaffold",
			version: "0.0.1-dev.79",
			private: true,
		}),
		[`${root}/projects/create/package.json`]: JSON.stringify({
			name: "@decohere/create",
			version: "0.0.1-dev.79",
			decohere: { dockerImageRepository: "ghcr.io/typesmiths/decohere/create" },
		}),
		[`${root}/projects/devcontainer/package.json`]: JSON.stringify({
			name: "@decohere/devcontainer",
			private: true,
			decohere: { dockerImageRepository: "ghcr.io/typesmiths/decohere/devcontainer" },
		}),
	});
	return root;
}

afterEach(() => {
	vol.reset();
});

describe("publish-verify", () => {
	it("lists non-private workspace packages", () => {
		const root = seedWorkspace();
		expect(listPublishablePackages(root).map((pkg) => pkg.name)).toEqual([
			"@decohere/cli",
			"@decohere/create",
		]);
	});

	it("lists grouped packages (projects/<group>/<name>) and skips nested and build folders", () => {
		const root = seedWorkspace();
		vol.fromJSON({
			[`${root}/projects/data/data/package.json`]: JSON.stringify({ name: "@decohere/data" }),
			[`${root}/projects/data/data-typeorm/package.json`]: JSON.stringify({
				name: "@decohere/data-typeorm",
			}),
			[`${root}/projects/cli/examples/demo/package.json`]: JSON.stringify({ name: "nested" }),
			[`${root}/projects/__fixtures__/app/package.json`]: JSON.stringify({ name: "fixture" }),
			[`${root}/projects/node_modules/dep/package.json`]: JSON.stringify({ name: "dep" }),
			[`${root}/projects/dist/out/package.json`]: JSON.stringify({ name: "built" }),
		});
		expect(listPublishablePackages(root).map((pkg) => pkg.name)).toEqual([
			"@decohere/cli",
			"@decohere/create",
			"@decohere/data",
			"@decohere/data-typeorm",
		]);
	});

	it("parses GHCR repository coordinates", () => {
		expect(parseGhcrRepository("ghcr.io/typesmiths/decohere/create")).toEqual({
			org: "typesmiths",
			packageName: "decohere/create",
		});
	});

	it("marks names missing from npm as unpublished and skip_npm when every version exists", async () => {
		const root = seedWorkspace();
		const views = [];
		const spawnSync = (_cmd, args) => {
			views.push(args[1]);
			if (args[1] === "@decohere/cli") {
				return { status: 1 };
			}
			return { status: 0 };
		};
		const result = await collectPublishVerify({
			root,
			spawnSync,
			githubToken: "",
		});
		expect(result.unpublished).toEqual(["@decohere/cli"]);
		expect(result.skipNpm).toBe(false);
		expect(views).toContain("@decohere/cli");
		expect(views).toContain("@decohere/create");
		expect(views).toContain("@decohere/create@0.0.1-dev.79");
	});

	it("sets skip_docker when both GHCR tags exist", async () => {
		const root = seedWorkspace();
		const fetch = async () => ({
			ok: true,
			status: 200,
			json: async () => [{ metadata: { container: { tags: ["0.0.1-dev.79"] } } }],
		});
		const result = await collectPublishVerify({
			root,
			spawnSync: () => ({ status: 0 }),
			githubToken: "ghs_test",
			fetch,
		});
		expect(result.skipDocker).toBe(true);
		expect(formatGithubOutput(result)).toContain("skip_docker=true");
	});
});
