import { ServiceContainerBuilder } from "@decohere/crucible";
import { describe, expect, it } from "vitest";
import { App, Builder } from "@decohere/core/hosting";

describe("Builder", () => {
	it("builds a custom App subclass when provided", async () => {
		class CustomApp extends App {}

		const app = await Builder.create(new ServiceContainerBuilder()).build(CustomApp);
		expect(app).toBeInstanceOf(CustomApp);
	});
});

describe("importing @decohere/http", () => {
	it("adds nothing to Builder: features come from plugins", async () => {
		await import("../src/index.js");

		const methods = Object.getOwnPropertyNames(Builder.prototype).filter((name) =>
			/^with(?!Services$|HostedService$)/.test(name),
		);
		expect(methods).toEqual([]);
	});
});
