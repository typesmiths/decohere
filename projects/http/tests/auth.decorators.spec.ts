import { describe, expect, it } from "vitest";
import {
	Authorize,
	Controller,
	Get,
	getAuthorizeOptions,
} from "../src/routing/decorators/index.js";

describe("@Authorize decorator", () => {
	it("defaults subject to 'all' when omitted", () => {
		@Controller()
		class TestController {
			@Authorize("read")
			@Get("/")
			public index() {}
		}
		const opts = getAuthorizeOptions(TestController.prototype, TestController.prototype.index);
		expect(opts).toEqual({ action: "read", subject: "all" });
	});
});
