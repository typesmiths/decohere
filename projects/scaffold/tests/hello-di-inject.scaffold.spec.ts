import { describe, expect, it } from "vitest";
import { ControllerSourceFile } from "../src/webapi/models/controller-source-file.model.js";

/**
 * Regression: SWC can emit design:paramtypes as Object when the service class is
 * only used as a type and its import is dropped. Explicit @inject is required, and it must name
 * the class itself: Container keys match by identity, so the string "SampleService" would
 * not find the class registered with cb.registerSingleton(SampleService).
 */
describe("HelloController DI inject tokens", () => {
	it("injects SampleService by its class", () => {
		const content = new ControllerSourceFile().files()[0]?.content ?? "";
		expect(content).toContain('import { inject } from "@decohere/crucible/decorators"');
		expect(content).toContain('import { SampleService } from "../services/sample.service.js"');
		expect(content).toContain("@inject(SampleService) private readonly sample: SampleService");
		expect(content).toContain("await this.sample.getGreeting()");
	});
});
