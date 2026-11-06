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
