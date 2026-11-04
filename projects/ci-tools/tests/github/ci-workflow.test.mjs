import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

const fs = await vi.importActual("node:fs");
const CI_YML = fileURLToPath(new URL("../../../../.github/workflows/ci.yml", import.meta.url));

describe("ci.yml and the merge queue", () => {
	const yml = fs.readFileSync(CI_YML, "utf8");
	const triggers = yml.slice(yml.indexOf("\non:"), yml.indexOf("\nconcurrency:"));
	const gate = yml.slice(yml.indexOf("- id: gate"), yml.indexOf("# Static gates"));

	it("runs for queued pull requests, or the queue waits forever for the required check", () => {
		expect(triggers).toMatch(/^\s+merge_group:/m);
	});

	it("runs the whole suite in the queue: the docs-only shortcut is only for pull requests", () => {
		expect(gate).toContain('"${{ github.event_name }}" == "merge_group"');
	});
});
