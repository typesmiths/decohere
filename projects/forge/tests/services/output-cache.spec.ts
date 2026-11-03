import { FileEx } from "@decohere/core/io";
import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OutputCache } from "../../src/services/output-cache.js";
import { BuildTargets } from "../../src/types/build-target.type.js";
import { TransformResponse } from "../../src/types/transform-response.model.js";

const source = new FileEx({ fullPath: "/ws/src/a.ts", relativePath: "src/a.ts" });

function built(outputPath: string) {
	return TransformResponse.Success({
		file: source,
		code: "",
		target: BuildTargets.es6,
		fileName: "src/a.js",
		outputPath,
		config: {},
	});
}

afterEach(() => {
	resetMemfs();
});

describe("OutputCache", () => {
	it("records only successful outputs, replacing a source's earlier ones", () => {
		const cache = new OutputCache();
		cache.record([built("/ws/out/old.js")]);
		const failed = TransformResponse.Error({ file: source, messages: ["x"], config: {} });
		cache.record([built("/ws/out/es6/a.js"), built("/ws/out/cjs/a.js"), failed]);

		expect(cache.get(source.fullPath)?.map((r) => r.outputPath)).toEqual([
			"/ws/out/es6/a.js",
			"/ws/out/cjs/a.js",
		]);
	});

	it("deletes a source's output files and forgets them", async () => {
		vol.fromJSON({ "/ws/out/es6/a.js": "", "/ws/out/cjs/a.js": "", "/ws/out/b.js": "" });
		const cache = new OutputCache();
		cache.record([built("/ws/out/es6/a.js"), built("/ws/out/cjs/a.js")]);

		cache.delete(source.fullPath);

		expect(cache.get(source.fullPath)).toBeUndefined();
		const files = () =>
			Object.entries(vol.toJSON())
				.filter(([, content]) => content != null)
				.map(([file]) => file);
		await vi.waitFor(() => expect(files()).toEqual(["/ws/out/b.js"]));
	});
});
