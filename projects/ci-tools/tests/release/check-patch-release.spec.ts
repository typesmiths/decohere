import { describe, expect, it } from "vitest";
import { checkPatchRelease } from "../../src/release/check-patch-release.mjs";

describe("checkPatchRelease", () => {
	it("accepts the next patch on the branch of the newest release", () => {
		expect(() =>
			checkPatchRelease({ branch: "release/0.1", version: "0.1.1", latest: "0.1.0" }),
		).not.toThrow();
	});

	it("accepts a patch while latest is still a dev version", () => {
		expect(() =>
			checkPatchRelease({
				branch: "release/0.0",
				version: "0.0.2",
				latest: "0.0.1-dev.20261105.119",
			}),
		).not.toThrow();
	});

	it.each([
		["release", "0.1.1", "isn't a patch branch"],
		["main", "0.1.1", "isn't a patch branch"],
		["release/0.1.1", "0.1.1", "isn't a patch branch"],
		["release/0.1", "0.2.1", "isn't on release/0.1"],
		["release/0.1", "0.1.0", "isn't a patch"],
	])("refuses %s at %s", (branch, version, message) => {
		expect(() => checkPatchRelease({ branch, version, latest: "0.0.9" })).toThrow(message);
	});

	it("refuses a patch that would move latest backwards", () => {
		expect(() =>
			checkPatchRelease({ branch: "release/0.1", version: "0.1.3", latest: "0.2.0" }),
		).toThrow("older than latest (0.2.0)");
	});

	it("refuses a version that's already latest", () => {
		expect(() =>
			checkPatchRelease({ branch: "release/0.1", version: "0.1.1", latest: "0.1.1" }),
		).toThrow("older than latest");
	});
});
