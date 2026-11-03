import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { afterEach, expect, it } from "vitest";
import { UserConfigFactory } from "../../../workspace/src/factories/config.factory.js";

// Each fixture file must exist on disk so vitest marks them as "external" and the
// module load hook (test/external-module.setup.ts) can intercept the import and
// serve memfs content. One fixture file per test — ESM caches by URL so two tests
// importing the same path would get stale content.
const fixtureDir = new URL("../__fixtures__", import.meta.url).pathname;
const configFile = `${fixtureDir}/.decohere.js`;
const configFileProjects = `${fixtureDir}/.decohere.projects.js`;

afterEach(() => {
	resetMemfs();
});

it("should return empty object when config file does not exist", async () => {
	const result = await UserConfigFactory.getUserConfig("/non/existent/.decohere.js");
	expect(result).toEqual({});
});

it("should return empty object when config file path is empty", async () => {
	const result = await UserConfigFactory.getUserConfig("");
	expect(result).toEqual({});
});

it("should load and return config from a valid config file", async () => {
	const rootDir = "/CUSTOM_ROOT";
	vol.fromJSON({
		[configFile]: `export default { rootDir: '${rootDir}' }`,
	});

	const result = await UserConfigFactory.getUserConfig(configFile);

	expect(result).toEqual({ rootDir });
});

it("should load config with project overrides", async () => {
	vol.fromJSON({
		[configFileProjects]: `export default { projects: { "my-pkg": { include: ["src/**"] } } }`,
	});

	const result = await UserConfigFactory.getUserConfig(configFileProjects);

	expect(result.projects?.["my-pkg"]?.include).toEqual(["src/**"]);
});
