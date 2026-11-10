import { forgeBuild } from "@decohere/forge/vitest";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [forgeBuild({ logLevel: "silent" })],
	test: {
		include: ["projects/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
	},
});
