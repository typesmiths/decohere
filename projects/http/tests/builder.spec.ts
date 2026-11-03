import { describe, expect, it } from "vitest";
import { App } from "../src/app/app.js";
import { Builder } from "../src/builder/builder.js";

describe("Builder", () => {
	it("builds a custom App subclass when provided", async () => {
		class CustomApp extends App {}

		const app = await Builder.create().build(CustomApp);
		expect(app).toBeInstanceOf(CustomApp);
	});
});
