import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const fs = await vi.importActual<typeof import("node:fs")>("node:fs");

// The manifest npm installs from: `forge dependencies sync` writes it from what the shipped code
// imports, and CI fails when it drifts from that.
const manifest: { dependencies?: Record<string, string> } = JSON.parse(
	fs.readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
);

const isFastify = (name: string) => name === "fastify" || name.startsWith("@fastify/");

describe("installing @decohere/http", () => {
	it("installs no Fastify: the provider is its own package", () => {
		expect(Object.keys(manifest.dependencies ?? {}).filter(isFastify)).toEqual([]);
	});
});
