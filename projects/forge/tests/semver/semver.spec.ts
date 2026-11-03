import { describe, expect, it } from "vitest";
import { Semver, SemverError } from "../../src/semver/index.js";

describe("Semver", () => {
	it("bumps major versions", () => {
		expect(new Semver("1.2.3").increment("major").toString()).toBe("2.0.0");
	});

	it("bumps minor versions", () => {
		expect(new Semver("1.2.3").increment("minor").toString()).toBe("1.3.0");
	});

	it("bumps patch versions", () => {
		expect(new Semver("1.2.3").increment("patch").toString()).toBe("1.2.4");
	});

	it("starts prerelease when none exists", () => {
		expect(new Semver("1.2.3").increment("prerelease", "dev").toString()).toBe("1.2.4-dev.0");
	});

	it("increments prerelease counter when identifier matches", () => {
		expect(new Semver("1.2.3-dev.4").increment("prerelease", "dev").toString()).toBe(
			"1.2.3-dev.5",
		);
	});

	it("resets prerelease counter when identifier differs", () => {
		expect(new Semver("1.2.3-rc.4").increment("prerelease", "dev").toString()).toBe(
			"1.2.3-dev.0",
		);
	});

	it("preserves prerelease dotted segments before counter", () => {
		expect(new Semver("1.2.3-dev.feature.7").increment("prerelease", "dev").toString()).toBe(
			"1.2.3-dev.feature.8",
		);
	});

	it("allows chained increments", () => {
		expect(
			new Semver("1.2.3").increment("patch").increment("prerelease", "dev").toString(),
		).toBe("1.2.5-dev.0");
	});

	it("throws SemverError for invalid semantic version", () => {
		expect(() => new Semver("not-a-version")).toThrow(SemverError);
		expect(() => new Semver("not-a-version")).toThrow(
			"Invalid semantic version: not-a-version",
		);
	});
});
