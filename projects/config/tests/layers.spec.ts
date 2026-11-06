import { Builder, type HostedService } from "@decohere/core/hosting";
import { ServiceContainerBuilder } from "@decohere/crucible";
import { inject } from "@decohere/crucible/decorators";
import { describe, expect, it } from "vitest";
import {
	config,
	configSection,
	ConfigurationDataSource,
	ConfigurationError,
	ConfigurationService,
	EnvDataSource,
	envToTree,
} from "../src/index.js";

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
