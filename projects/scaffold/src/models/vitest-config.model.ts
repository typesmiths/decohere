import { WELL_KNOWN_FILES } from "./const.js";
import type { KeyedModel, SourceFile } from "./source-file.js";

export class VitestConfig implements KeyedModel {
	public readonly key = WELL_KNOWN_FILES.VITEST_CONFIG;

	public files(): SourceFile[] {
		return [
			{
				filePath: "vitest.config.ts",
				content: [
					'import { forgeBuild } from "@decohere/forge/vitest";',
					'import { defineConfig } from "vitest/config";',
					"",
					"export default defineConfig({",
					'\tplugins: [forgeBuild({ logLevel: "silent" })],',
					"\ttest: {",
					'\t\tinclude: ["projects/**/*.{test,spec}.?(c|m)[jt]s?(x)"],',
					"\t},",
					"});",
					"",
				].join("\n"),
			},
		];
	}
}
