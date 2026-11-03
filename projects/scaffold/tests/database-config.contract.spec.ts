import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetMemfs } from "@decohere/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveYamlConfig } from "../../config/src/yaml-data-source.js";
import { seedDevcontainerTemplates } from "./seed-devcontainer-templates.js";

/**
 * Contract: the config files the scaffold writes are read the way an app boots them.
 *
 * The scaffold writes config/config.yaml (production) and config/config.dev.yaml (an overlay
 * that only states what development changes); @decohere/config merges them. Each side had its
 * own tests, so when the merge stopped merging lists, the overlay silently replaced every data
 * source and dev boot failed with "has no password".
 */

const mockPm = {
	name: "pnpm" as const,
	install: vi.fn().mockResolvedValue({ message: "", data: [] }),
	syncLockFile: vi.fn().mockResolvedValue({ message: "", data: [] }),
};

vi.mock(import("../../devkit/src/interop/index.js"), async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		detectPackageManager: () => mockPm,
		promptForPackageManager: () => Promise.resolve(mockPm),
	};
});

vi.mock("../src/webapi/features/biome-format.js", () => ({
	formatScaffoldedFiles: vi.fn(),
}));

const { scaffoldApi } = await import("../src/webapi/create-api.js");

const TARGET = "/my-app";

function scaffold(names: string[], add = false) {
	return scaffoldApi({
		d: TARGET,
		names,
		add,
		databaseProvider: "postgres/typeorm",
		authProvider: "none",
		postmanProvider: "none",
		installDependencies: "no",
	});
}

const read = (rel: string) => readFileSync(join(TARGET, rel), "utf8");

/** The scaffolded .env, as `--env-file .env` would load it. */
function envFile(): Record<string, string> {
	const entries = read(".env")
		.split("\n")
		.filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
		.map((line) => {
			const at = line.indexOf("=");
			return [line.slice(0, at), line.slice(at + 1)] as const;
		});
	return Object.fromEntries(entries);
}

type DataSource = Record<string, unknown>;

/** Boot the config the way the app does: config.yaml, then config.<env>.yaml, with .env set. */
function bootConfig(env: "production" | "dev"): DataSource[] {
	const files = [{ name: "config.yaml", text: read("config/config.yaml") }];
	if (env === "dev") {
		files.push({ name: "config.dev.yaml", text: read("config/config.dev.yaml") });
	}
	vi.stubEnv("NODE_ENV", env);
	for (const [key, value] of Object.entries(envFile())) {
		vi.stubEnv(key, value);
	}
	const config = resolveYamlConfig(files) as { database: { dataSources: DataSource[] } };
	return config.database.dataSources;
}

function connection(source: DataSource) {
	const { provider, host, port, database, username, password } = source;
	return { provider, host, port, database, username, password };
}

beforeEach(() => {
	vi.spyOn(process, "cwd").mockReturnValue("/");
	vi.stubEnv("DECOHERE_BUILDER", "1");
	resetMemfs();
	seedDevcontainerTemplates();
});

afterEach(() => {
	resetMemfs();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe("scaffolded database config ↔ @decohere/config contract", () => {
	it("keeps each data source's connection in dev and adds the dev settings", async () => {
		await scaffold(["api"]);

		const [production] = bootConfig("production");
		const [dev] = bootConfig("dev");

		expect(production).toMatchObject({ name: "api", synchronize: false, bootstrap: false });
		expect(production?.password).toEqual(expect.any(String));
		expect(String(production?.password).length).toBeGreaterThan(0);
		expect(connection(dev!)).toEqual(connection(production!));
		expect(dev).toMatchObject({
			name: "api",
			synchronize: true,
			seed: true,
			bootstrap: true,
			adminUser: expect.any(String),
		});
	});

	it("pairs every API's dev settings with its own data source", async () => {
		await scaffold(["api", "billing"]);

		const production = bootConfig("production");
		const dev = bootConfig("dev");

		expect(dev.map((source) => source.name)).toEqual(["api", "billing"]);
		for (const [index, source] of dev.entries()) {
			expect(connection(source)).toEqual(connection(production[index]!));
			expect(source).toMatchObject({ synchronize: true, bootstrap: true });
		}
		expect(dev[0]?.database).not.toEqual(dev[1]?.database);
	});

	it("still pairs them after `add api` appends a data source to existing files", async () => {
		await scaffold(["api"]);
		await scaffold(["billing"], true);

		const production = bootConfig("production");
		const dev = bootConfig("dev");

		expect(dev.map((source) => source.name)).toEqual(["api", "billing"]);
		for (const [index, source] of dev.entries()) {
			expect(connection(source)).toEqual(connection(production[index]!));
			expect(source).toMatchObject({ synchronize: true, bootstrap: true });
		}
	});
});
