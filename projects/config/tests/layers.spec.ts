import { ApiConfiguration, Builder, type HostedService } from "@decohere/core/hosting";
import { ServiceContainerBuilder } from "@decohere/crucible";
import { inject } from "@decohere/crucible/decorators";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	config,
	configSection,
	ConfigurationDataSource,
	ConfigurationError,
	ConfigurationService,
	EnvDataSource,
	envToTree,
} from "../src/index.js";
import { resolveYamlConfig } from "../src/yaml-data-source.js";

function source(data: Record<string, unknown>): ConfigurationDataSource {
	return new (class extends ConfigurationDataSource {
		public name = "test";
		public async getData() {
			return data;
		}
	})();
}

class PaymentsConfig {
	public static schema = {
		type: "object",
		required: ["provider"],
		properties: {
			provider: { type: "string" },
			retries: { type: "integer", minimum: 0 },
			limits: { type: "object", properties: { daily: { type: "number" } } },
		},
	};
	public provider!: string;
	public retries = 3;
	public limits = { daily: 100, monthly: 1000 };
	public regions = ["eu", "us"];
}

describe("config layers", () => {
	it("later sources override earlier ones, key by key", async () => {
		const service = new ConfigurationService([
			source({ payments: { provider: "a", limits: { daily: 1, monthly: 2 } } }),
			source({ payments: { limits: { daily: 9 } } }),
		]);

		const payments = await service.get(PaymentsConfig);

		expect(payments.provider).toBe("a");
		expect(payments.limits).toEqual({ daily: 9, monthly: 2 });
	});

	it("keeps the class's nested defaults when a source sets a sibling", async () => {
		const service = new ConfigurationService([
			source({ payments: { provider: "a", limits: { daily: 5 } } }),
		]);

		const payments = await service.get(PaymentsConfig);

		expect(payments).toBeInstanceOf(PaymentsConfig);
		expect(payments.retries).toBe(3);
		expect(payments.limits).toEqual({ daily: 5, monthly: 1000 });
	});

	it("replaces a plain list rather than adding to it", async () => {
		const service = new ConfigurationService([
			source({ payments: { provider: "a", regions: ["asia"] } }),
		]);

		expect((await service.get(PaymentsConfig)).regions).toEqual(["asia"]);
	});

	it("merges named lists across sources, as the YAML files do", async () => {
		const service = new ConfigurationService([
			source({ database: { dataSources: [{ name: "api", host: "a", port: 1 }] } }),
			source({ database: { dataSources: [{ name: "api", host: "b" }] } }),
		]);

		expect(await service.get("database")).toEqual({
			dataSources: [{ name: "api", host: "b", port: 1 }],
		});
	});

	it("doesn't change a default shared between instances", async () => {
		class Shared {
			public nested = { a: 1 };
		}
		const service = new ConfigurationService([source({ shared: { nested: { b: 2 } } })]);

		await service.get(Shared);

		expect(new Shared().nested).toEqual({ a: 1 });
	});
});

describe("schema checks", () => {
	it("turns text into the type the schema asks for", async () => {
		const service = new ConfigurationService([
			source({ payments: { provider: "a", retries: "5", limits: { daily: "2.5" } } }),
		]);

		const payments = await service.get(PaymentsConfig);

		expect(payments.retries).toBe(5);
		expect(payments.limits.daily).toBe(2.5);
	});

	it("names every bad path, and no value", async () => {
		const service = new ConfigurationService([
			source({ payments: { retries: "sup3r-s3cret", limits: { daily: "hunter2" } } }),
		]);

		const error = await service.get(PaymentsConfig).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(ConfigurationError);
		const message = (error as Error).message;
		expect(message).toContain('section "payments"');
		expect(message).toContain("payments.provider");
		expect(message).toContain("payments.retries: must be integer");
		expect(message).toContain("payments.limits.daily: must be number");
		expect(message).not.toContain("sup3r-s3cret");
		expect(message).not.toContain("hunter2");
	});

	it("refuses a section that isn't a mapping", async () => {
		const service = new ConfigurationService([source({ payments: "oops" })]);

		await expect(service.get(PaymentsConfig)).rejects.toThrow(/section "payments".*mapping/);
	});

	it("treats an empty section as no values", async () => {
		class Plain {
			public a = 1;
		}
		const service = new ConfigurationService([source({ plain: null })]);

		expect((await service.get(Plain)).a).toBe(1);
	});
});

describe("environment variables", () => {
	it("maps SECTION__KEY_NAME to section.keyName, at any depth", () => {
		expect(
			envToTree({
				API__PORT: "4000",
				AUTH__DISCOVERY_URL: "https://x",
				DATABASE__POOL__MAX_SIZE: "9",
			}),
		).toEqual({
			api: { port: "4000" },
			auth: { discoveryUrl: "https://x" },
			database: { pool: { maxSize: "9" } },
		});
	});

	it("ignores everything else", () => {
		expect(
			envToTree({
				PATH: "/bin",
				NODE_ENV: "test",
				lower__case: "x",
				npm_config__x: "x",
				__LEADING: "x",
				TRAILING__: "x",
				EMPTY____SEGMENT: "x",
				API__UNSET: undefined,
				API__CONSTRUCTOR: "x",
				PROTOTYPE__X: "x",
			}),
		).toEqual({});
	});

	it("overrides YAML's nested value, with the right type", async () => {
		process.env.PAYMENTS__RETRIES = "7";
		try {
			const service = new ConfigurationService([
				source({ payments: { provider: "a", retries: 1 } }),
				new EnvDataSource(),
			]);

			const payments = await service.get(PaymentsConfig);

			expect(payments.provider).toBe("a");
			expect(payments.retries).toBe(7);
		} finally {
			delete process.env.PAYMENTS__RETRIES;
		}
	});
});

describe("configSection", () => {
	it("stops the build on bad config, and injects a good section by its class", async () => {
		const build = (retries: string) => {
			const source = class extends ConfigurationDataSource {
				public name = "test";
				public async getData() {
					return { payments: { provider: "a", retries } };
				}
			};
			return Builder.create(new ServiceContainerBuilder())
				.use(config(source))
				.use(configSection(PaymentsConfig));
		};

		await expect(build("lots").build()).rejects.toThrow("payments.retries: must be integer");
		const seen: PaymentsConfig[] = [];
		class Reader implements HostedService {
			public constructor(@inject(PaymentsConfig) private readonly payments: PaymentsConfig) {}
			public start() {
				seen.push(this.payments);
			}
		}
		const app = await build("5").withHostedService(Reader).build();
		await app.start({ port: 0, shutdownSignals: false });
		await app.dispose();

		expect(seen[0]?.retries).toBe(5);
	});
});

describe("what a later layer can clear", () => {
	class Auth {
		public provider = "default";
		public devUser?: string;
	}
	const named = (...sections: Record<string, unknown>[]) =>
		new ConfigurationService(sections.map(source));

	it("keeps a key a later layer doesn't mention", async () => {
		const auth = await named(
			{ auth: { provider: "dev", devUser: "admin" } },
			{ auth: { provider: "oidc" } },
		).get(Auth);

		expect(auth).toMatchObject({ provider: "oidc", devUser: "admin" });
	});

	it("clears nothing with an empty section", async () => {
		const auth = await named({ auth: { devUser: "admin" } }, { auth: {} }).get(Auth);

		expect(auth.devUser).toBe("admin");
	});

	it("clears a key set to null, back to the class's default", async () => {
		const auth = await named(
			{ auth: { provider: "dev", devUser: "admin" } },
			{ auth: { provider: null, devUser: null } },
		).get(Auth);

		expect(auth.provider).toBe("default");
		expect(auth.devUser).toBeUndefined();
	});

	it("clears a section set to null, back to the class's defaults", async () => {
		const auth = await named(
			{ auth: { provider: "dev", devUser: "admin" } },
			{ auth: null },
		).get(Auth);

		expect(auth.provider).toBe("default");
		expect(auth.devUser).toBeUndefined();
	});

	it("lets a null clear a key by name too, inside a named list entry", async () => {
		const service = named(
			{ database: { dataSources: [{ name: "api", synchronize: true }] } },
			{ database: { dataSources: [{ name: "api", synchronize: null }] } },
		);

		expect(await service.get("database")).toEqual({ dataSources: [{ name: "api" }] });
	});

	it("lets a scalar replace a section, and a section replace a scalar", async () => {
		await expect(
			named({ auth: { provider: "a" } }, { auth: "text" }).get("auth"),
		).resolves.toBe("text");
		await expect(
			named({ auth: "text" }, { auth: { provider: "a" } }).get(Auth),
		).resolves.toMatchObject({ provider: "a" });
		await expect(
			named({ auth: { provider: "a" } }, { auth: "text" }).get(Auth),
		).rejects.toThrow(/must be a mapping/);
	});

	it("fails required on null, instead of coercing it to an empty value", async () => {
		const service = named({ payments: { provider: null, retries: null } });

		await expect(service.get(PaymentsConfig)).rejects.toThrow(
			"payments.provider: must have required",
		);
	});

	it("uses the default for a null, instead of coercing it to 0", async () => {
		const payments = await named({ payments: { provider: "a", retries: null } }).get(
			PaymentsConfig,
		);

		expect(payments.retries).toBe(3);
	});
});

describe("clashing environment variables", () => {
	it.each([
		[{ API__A: "1", API__A__B: "2" }],
		[{ API__A__B: "2", API__A: "1" }],
		[{ API__A_1: "1", API__A1: "2" }],
	])("refuses %j, naming both and neither value", (env) => {
		const names = Object.keys(env);
		const check = () => envToTree(env);

		expect(check).toThrow(ConfigurationError);
		expect(check).toThrow(names[0]!);
		expect(check).toThrow(names[1]!);
	});

	it("allows siblings that share a prefix", () => {
		expect(envToTree({ API__A: "1", API__AB: "2", API__C__D: "3", API__C__E: "4" })).toEqual({
			api: { a: "1", ab: "2", c: { d: "3", e: "4" } },
		});
	});
});

describe("devOnly in a schema", () => {
	class DevAuth {
		public static schema = {
			type: "object",
			properties: {
				provider: { type: "string" },
				devUser: { type: "string", devOnly: true },
				nested: { type: "object", properties: { key: { devOnly: true } } },
			},
		};
		public provider?: string;
		public devUser?: string;
		public nested?: { key?: string };
	}
	const load = (auth: Record<string, unknown>) =>
		new ConfigurationService([source({ devAuth: auth })]).get(DevAuth);

	afterEach(() => vi.unstubAllEnvs());

	it.each(["production", "staging", "prod", "develop", "test", ""])(
		"refuses a value when NODE_ENV is %j, naming the path and not the value",
		async (env) => {
			vi.stubEnv("NODE_ENV", env);

			const error = await load({ devUser: "sup3r-s3cret", nested: { key: "hunter2" } }).catch(
				(caught: unknown) => caught as Error,
			);

			expect(error).toBeInstanceOf(ConfigurationError);
			const { message } = error as Error;
			expect(message).toContain("devAuth.devUser: is only allowed when NODE_ENV");
			expect(message).toContain("devAuth.nested.key: is only allowed when NODE_ENV");
			expect(message).not.toContain("sup3r-s3cret");
			expect(message).not.toContain("hunter2");
		},
	);

	it("refuses it when NODE_ENV is unset", async () => {
		vi.stubEnv("NODE_ENV", undefined as unknown as string);

		await expect(load({ devUser: "admin" })).rejects.toThrow("devAuth.devUser");
	});

	it.each(["development", "dev", "DEV"])("allows it when NODE_ENV is %j", async (env) => {
		vi.stubEnv("NODE_ENV", env);

		await expect(load({ devUser: "admin" })).resolves.toMatchObject({ devUser: "admin" });
	});

	it("doesn't mind the key being absent or null outside development", async () => {
		vi.stubEnv("NODE_ENV", "production");

		await expect(load({ provider: "oidc", devUser: null })).resolves.toMatchObject({
			provider: "oidc",
		});
	});

	it("refuses a dev value left as a class default", async () => {
		vi.stubEnv("NODE_ENV", "production");
		class WithDefault {
			public static schema = { type: "object", properties: { devUser: { devOnly: true } } };
			public devUser = "admin";
		}

		await expect(new ConfigurationService([]).get(WithDefault)).rejects.toThrow(
			"withDefault.devUser",
		);
	});
});

describe("undeclared keys", () => {
	it("stops the api section, naming the key and not its value", async () => {
		const service = new ConfigurationService([
			source({ api: { port: 1, prot: "sup3r-s3cret" } }),
		]);

		const error = await service
			.get(ApiConfiguration)
			.catch((caught: unknown) => caught as Error);

		expect((error as Error).message).toContain(
			"api.prot: must NOT have additional properties",
		);
		expect((error as Error).message).not.toContain("sup3r-s3cret");
	});

	it("stops it for a stray variable too", async () => {
		vi.stubEnv("API__PROT", "1");
		try {
			const service = new ConfigurationService([new EnvDataSource()]);

			await expect(service.get(ApiConfiguration)).rejects.toThrow("api.prot");
		} finally {
			vi.unstubAllEnvs();
		}
	});
});

describe("keys every object inherits", () => {
	it("refuses them from any source, at any depth", async () => {
		const parsed = JSON.parse('{"auth":{"list":[{"__proto__":{"polluted":1}}]}}') as Record<
			string,
			unknown
		>;

		await expect(new ConfigurationService([source(parsed)]).get("auth")).rejects.toThrow(
			"auth.list[0].__proto__",
		);
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
	});

	it.each(["__proto__", "constructor", "prototype"])(
		"refuses %s from a real YAML file",
		(key) => {
			const text = `auth:\n  ${key}:\n    polluted: 1\n`;

			expect(() => resolveYamlConfig([{ name: "config.yaml", text }])).toThrow(`auth.${key}`);
			expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		},
	);
});

describe("config()", () => {
	it("stops the build when a source fails, with no section read yet", async () => {
		class Broken extends ConfigurationDataSource {
			public name = "broken";
			public async getData(): Promise<Record<string, unknown>> {
				throw new ConfigurationError("cannot read");
			}
		}

		await expect(
			Builder.create(new ServiceContainerBuilder()).use(config(Broken)).build(),
		).rejects.toThrow("cannot read");
	});
});
