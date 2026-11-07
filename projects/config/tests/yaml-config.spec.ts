import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigurationError } from "../src/errors.js";
import { resolveYamlConfig, YamlDataSource } from "../src/yaml-data-source.js";

const file = (name: string, text: string) => ({ name, text });

describe("YAML config: merge the files first, then resolve ${VAR}", () => {
	const touched: string[] = [];

	function setEnv(name: string, value: string | undefined) {
		touched.push(name);
		if (value === undefined) delete process.env[name];
		else process.env[name] = value;
	}

	afterEach(() => {
		for (const name of touched.splice(0)) delete process.env[name];
	});

	it("lets a later file replace a ${VAR} without that variable being set", () => {
		setEnv("DB_HOST_634", undefined);

		const config = resolveYamlConfig([
			file("config.yaml", "database:\n  host: ${DB_HOST_634}\n  port: 5432\n"),
			file("config.dev.yaml", "database:\n  host: postgres\n"),
		]);

		expect(config).toEqual({ database: { host: "postgres", port: 5432 } });
	});

	it("resolves a ${VAR} that no later file replaces", () => {
		setEnv("DB_HOST_634", "db.internal");

		const config = resolveYamlConfig([
			file("config.yaml", "database:\n  host: ${DB_HOST_634}\n"),
			file("config.dev.yaml", "database:\n  port: 5433\n"),
		]);

		expect(config).toEqual({ database: { host: "db.internal", port: 5433 } });
	});

	it("fails listing every missing variable and where it was used", () => {
		setEnv("MISSING_A_634", undefined);
		setEnv("MISSING_B_634", undefined);
		setEnv("MISSING_C_634", undefined);
		const base = [
			"database:",
			"  host: ${MISSING_A_634}",
			"  password: ${MISSING_B_634}",
			"auth:",
			"  domain: ${MISSING_C_634}",
			"",
		].join("\n");

		let failure: unknown;
		try {
			resolveYamlConfig([
				file("config.yaml", base),
				file("config.dev.yaml", "auth:\n  domain: dev.example.com\n"),
			]);
		} catch (error) {
			failure = error;
		}

		expect(failure).toBeInstanceOf(ConfigurationError);
		const message = (failure as Error).message;
		expect(message).toContain("MISSING_A_634 (used at database.host)");
		expect(message).toContain("MISSING_B_634 (used at database.password)");
		// The dev file replaces auth.domain, so that one is not missing.
		expect(message).not.toContain("MISSING_C_634");
	});

	it("names the path inside lists", () => {
		setEnv("ORIGIN_634", undefined);

		expect(() =>
			resolveYamlConfig([file("config.yaml", "cors:\n  origins:\n    - ${ORIGIN_634}\n")]),
		).toThrow(/ORIGIN_634 \(used at cors\.origins\[0\]\)/);
	});

	it("reports only the variable that is missing inside a longer value", () => {
		setEnv("HOST_634", "db");
		setEnv("PORT_634", undefined);

		expect(() =>
			resolveYamlConfig([
				file("config.yaml", "url: postgres://${HOST_634}:${PORT_634}/app\n"),
			]),
		).toThrow(/PORT_634 \(used at url\)/);
	});

	it("substitutes into a longer value", () => {
		setEnv("HOST_634", "db");
		setEnv("PORT_634", "5432");

		const config = resolveYamlConfig([
			file("config.yaml", "url: postgres://${HOST_634}:${PORT_634}/app\n"),
		]);

		expect(config).toEqual({ url: "postgres://db:5432/app" });
	});

	it("keeps ${VAR:default} for optional values", () => {
		setEnv("OPTIONAL_634", undefined);
		setEnv("OVERRIDDEN_634", "from-env");

		const config = resolveYamlConfig([
			file(
				"config.yaml",
				"a: ${OPTIONAL_634:fallback}\nb: ${OVERRIDDEN_634:fallback}\nc: ${OPTIONAL_634:}\n",
			),
		]);

		expect(config).toEqual({ a: "fallback", b: "from-env", c: "" });
	});

	it("treats a variable set to an empty string as set", () => {
		setEnv("EMPTY_634", "");

		expect(resolveYamlConfig([file("config.yaml", "token: ${EMPTY_634}\n")])).toEqual({
			token: "",
		});
	});

	it("turns a placeholder that resolves to the text null into null", () => {
		setEnv("NOTHING_634", "null");

		expect(resolveYamlConfig([file("config.yaml", "value: ${NOTHING_634}\n")])).toEqual({
			value: null,
		});
	});

	it("merges objects deeply and lets a later file replace lists and scalars", () => {
		const config = resolveYamlConfig([
			file("config.yaml", "a:\n  x: 1\n  y: 2\nlist: [1, 2, 3]\nkeep: base\n"),
			file("config.dev.yaml", "a:\n  y: 20\nlist: [9]\n"),
		]);

		expect(config).toEqual({ a: { x: 1, y: 20 }, list: [9], keep: "base" });
	});

	it("merges lists of named entries by name, so an overlay changes only what it sets", () => {
		setEnv("DB_PASSWORD_692", "s3cret");

		const config = resolveYamlConfig([
			file(
				"config.yaml",
				[
					"database:",
					"  dataSources:",
					"    - name: api",
					"      host: db.internal",
					"      password: ${DB_PASSWORD_692}",
					"      synchronize: false",
					"    - name: reports",
					"      host: reports.internal",
					"",
				].join("\n"),
			),
			file(
				"config.dev.yaml",
				[
					"database:",
					"  dataSources:",
					"    - name: reports",
					"      host: localhost",
					"    - name: api",
					"      synchronize: true",
					"    - name: audit",
					"      host: audit.local",
					"",
				].join("\n"),
			),
		]);

		expect(config).toEqual({
			database: {
				dataSources: [
					{ name: "api", host: "db.internal", password: "s3cret", synchronize: true },
					{ name: "reports", host: "localhost" },
					{ name: "audit", host: "audit.local" },
				],
			},
		});
	});

	it("replaces a list when its entries are not all named", () => {
		const config = resolveYamlConfig([
			file("config.yaml", "items:\n  - name: a\n    x: 1\n  - b\n"),
			file("config.dev.yaml", "items:\n  - name: a\n    y: 2\n"),
		]);

		expect(config).toEqual({ items: [{ name: "a", y: 2 }] });
	});

	it("rejects a named list that repeats a name, since the merge could not tell them apart", () => {
		expect(() =>
			resolveYamlConfig([
				file("config.yaml", "items:\n  - name: a\n  - name: a\n"),
				file("config.dev.yaml", "items:\n  - name: a\n    y: 2\n"),
			]),
		).toThrow(/config\.yaml.*items.*"a"/);
	});

	it("skips an empty file and rejects one that is not a mapping", () => {
		expect(
			resolveYamlConfig([file("config.yaml", ""), file("config.dev.yaml", "a: 1\n")]),
		).toEqual({
			a: 1,
		});
		expect(() => resolveYamlConfig([file("config.yaml", "- just\n- a list\n")])).toThrow(
			/config\.yaml.*mapping/,
		);
	});

	it("says which file could not be parsed", () => {
		expect(() => resolveYamlConfig([file("config.dev.yaml", "a: [unclosed\n")])).toThrow(
			/config\.dev\.yaml/,
		);
	});
});

describe("YamlDataSource reads config.yaml then config.<env>.yaml", () => {
	const saved = { CONFIG_DIR: process.env.CONFIG_DIR, NODE_ENV: process.env.NODE_ENV };

	beforeEach(() => {
		process.env.CONFIG_DIR = "/app/config";
		delete process.env.CRYPTO_DB_HOST;
	});

	afterEach(() => {
		vol.reset();
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it("boots dev when config.dev.yaml replaces the production placeholder", async () => {
		process.env.NODE_ENV = "dev";
		vol.fromJSON({
			"/app/config/config.yaml": "database:\n  host: ${CRYPTO_DB_HOST}\n",
			"/app/config/config.dev.yaml": "database:\n  host: postgres\n",
		});

		expect(await new YamlDataSource().getData()).toEqual({ database: { host: "postgres" } });
	});

	it("still requires the variable in production, where nothing replaces it", async () => {
		process.env.NODE_ENV = "production";
		vol.fromJSON({
			"/app/config/config.yaml": "database:\n  host: ${CRYPTO_DB_HOST}\n",
			"/app/config/config.dev.yaml": "database:\n  host: postgres\n",
		});

		await expect(new YamlDataSource().getData()).rejects.toThrow(/CRYPTO_DB_HOST/);
	});

	it("reads only the base file when there is no file for the environment", async () => {
		process.env.NODE_ENV = "staging";
		vol.fromJSON({ "/app/config/config.yaml": "name: api\n" });

		expect(await new YamlDataSource().getData()).toEqual({ name: "api" });
	});
});

describe("YamlDataSource: config.{optional app}.{optional env}.yaml", () => {
	beforeEach(() => {
		vol.reset();
		vol.fromJSON({
			"/c/config.yaml": "from: base\nbase: 1",
			"/c/config.billing.yaml": "from: app\napp: 1",
			"/c/config.production.yaml": "from: env\nenv: 1",
			"/c/config.billing.production.yaml": "from: both\nboth: 1",
			"/c/config.other.yaml": "other: 1",
			"/c/config.dev.yaml": "dev: 1",
		});
		vi.stubEnv("CONFIG_DIR", "/c");
		vi.stubEnv("NODE_ENV", "production");
	});
	afterEach(() => vi.unstubAllEnvs());

	it("reads base, app, env, then both, later winning", async () => {
		expect(await new YamlDataSource({ app: "billing" }).getData()).toEqual({
			from: "both",
			base: 1,
			app: 1,
			env: 1,
			both: 1,
		});
	});

	it("reads only base and env with no app", async () => {
		expect(await new YamlDataSource().getData()).toEqual({ from: "env", base: 1, env: 1 });
	});

	it("takes no app from the environment", async () => {
		vi.stubEnv("CONFIG_APP", "billing");

		expect(await new YamlDataSource().getData()).toEqual({ from: "env", base: 1, env: 1 });
	});

	it("reads config.dev.yaml as the environment when NODE_ENV is dev, with an app set too", async () => {
		vi.stubEnv("NODE_ENV", "dev");

		expect(await new YamlDataSource({ app: "billing" }).getData()).toEqual({
			from: "app",
			base: 1,
			app: 1,
			dev: 1,
		});
	});

	it("refuses an app named the same as the environment", async () => {
		await expect(new YamlDataSource({ app: "production" }).getData()).rejects.toThrow(
			/both an app and an environment/,
		);
	});

	it.each(["../secrets", "a.b", "a/b", ""])("refuses the app name %j", async (app) => {
		await expect(new YamlDataSource({ app }).getData()).rejects.toThrow(
			/can't name a config file/,
		);
	});
});
