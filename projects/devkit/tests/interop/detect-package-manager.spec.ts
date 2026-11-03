import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Npm } from "../../src/interop/npm/npm.js";
import { Pnpm } from "../../src/interop/pnpm/pnpm.js";
import {
	detectPackageManager,
	packageManagerFromString,
} from "../../src/interop/types/detect-package-manager.js";
import { Yarn } from "../../src/interop/yarn/yarn.js";

vi.mock("node:fs", () => ({ existsSync: vi.fn().mockReturnValue(false) }));

const { existsSync } = await import("node:fs");

describe("detectPackageManager", () => {
	beforeEach(() => {
		delete process.env.npm_config_user_agent;
	});

	afterEach(() => {
		vi.mocked(existsSync).mockReturnValue(false);
	});

	it("returns Pnpm when pnpm-lock.yaml exists", () => {
		vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith("pnpm-lock.yaml"));
		expect(detectPackageManager("/project")).toBeInstanceOf(Pnpm);
	});

	it("returns Yarn when yarn.lock exists", () => {
		vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith("yarn.lock"));
		expect(detectPackageManager("/project")).toBeInstanceOf(Yarn);
	});

	it("returns Npm when package-lock.json exists", () => {
		vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith("package-lock.json"));
		expect(detectPackageManager("/project")).toBeInstanceOf(Npm);
	});

	it("prefers lockfile over user agent", () => {
		vi.mocked(existsSync).mockImplementation((p) => String(p).endsWith("yarn.lock"));
		process.env.npm_config_user_agent = "pnpm/9.0.0";
		expect(detectPackageManager("/project")).toBeInstanceOf(Yarn);
	});

	it("falls back to user agent when no lockfile", () => {
		process.env.npm_config_user_agent = "pnpm/9.0.0 node/v22.0.0";
		expect(detectPackageManager("/project")).toBeInstanceOf(Pnpm);
	});

	it("returns undefined when no lockfile and no user agent", () => {
		expect(detectPackageManager("/project")).toBeUndefined();
	});
});

describe("packageManagerFromString", () => {
	it("returns Yarn for 'yarn'", () => {
		expect(packageManagerFromString("yarn")).toBeInstanceOf(Yarn);
	});

	it("returns Npm for 'npm'", () => {
		expect(packageManagerFromString("npm")).toBeInstanceOf(Npm);
	});

	it("returns Pnpm for 'pnpm'", () => {
		expect(packageManagerFromString("pnpm")).toBeInstanceOf(Pnpm);
	});

	it("defaults to Pnpm for unknown string", () => {
		expect(packageManagerFromString("bun")).toBeInstanceOf(Pnpm);
	});
});
