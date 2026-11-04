import { mkdirSync } from "node:fs";
import { vol } from "memfs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InteropError } from "../../src/interop/errors/interop.error.js";

const run = vi.hoisted(() => vi.fn());

vi.mock("../../src/interop/shell/shell.js", () => ({
	Shell: class {
		public run = run;
	},
}));

import { Npm } from "../../src/interop/npm/npm.js";

function seedPublishedPackage() {
	vol.fromJSON({
		"/pkg/package.json": JSON.stringify({
			name: "@decohere/cli",
			version: "0.0.1-dev.79",
		}),
	});
	mkdirSync("/tmp", { recursive: true });
}

describe("Npm", () => {
	const originalToken = process.env.NODE_AUTH_TOKEN;

	afterEach(() => {
		run.mockReset();
		vol.reset();
		if (originalToken == null) {
			delete process.env.NODE_AUTH_TOKEN;
		} else {
			process.env.NODE_AUTH_TOKEN = originalToken;
		}
	});

	it("calls install with no extra flags", async () => {
		await new Npm().install({ cwd: "/workspace" });
		expect(run).toHaveBeenCalledWith({ cwd: "/workspace" }, "install");
	});

	it("installs production dependencies as real folders, with no bin symlinks", async () => {
		await new Npm().installProduction({ cwd: "/out" });
		expect(run).toHaveBeenCalledWith(
			{ cwd: "/out" },
			"install",
			"--omit=dev",
			"--no-bin-links",
			"--no-audit",
			"--no-fund",
			"--loglevel=error",
		);
	});

	it("publish dry-run still packs via npm publish --dry-run", async () => {
		await new Npm().publish("dist/release/pkg", {
			channel: "dev",
			dryRun: true,
			skipIfPublished: true,
		});
		expect(run).toHaveBeenCalledWith(
			expect.objectContaining({ cwd: undefined, env: expect.any(Object) }),
			"publish",
			"./dist/release/pkg",
			"--tag",
			"dev",
			"--dry-run",
		);
		const env = run.mock.calls[0][0].env as NodeJS.ProcessEnv;
		expect(env.NODE_AUTH_TOKEN).toBeUndefined();
		expect(env.NPM_CONFIG_USERCONFIG).toBe("/dev/null");
	});

	it("publishes a relative folder as a path, not as GitHub shorthand", async () => {
		// A standalone project's release tree is `dist/release`, which npm would read as the
		// GitHub repository `dist/release` and try to clone.
		await new Npm().publish("dist/release", { channel: "dev", dryRun: true });
		expect(run).toHaveBeenCalledWith(
			expect.any(Object),
			"publish",
			"./dist/release",
			"--tag",
			"dev",
			"--dry-run",
		);
	});

	it("skipIfPublished uses ambient npm view (no token on argv)", async () => {
		seedPublishedPackage();
		process.env.NODE_AUTH_TOKEN = "read-token";
		run.mockResolvedValueOnce({ message: "view", data: ["0.0.1-dev.79"] });
		const result = await new Npm().publish("/pkg", { channel: "dev", skipIfPublished: true });
		expect(result.message).toMatch(/Skipping publish/);
		expect(run).toHaveBeenCalledTimes(1);
		expect(run.mock.calls[0][1]).toBe("view");
		expect(run.mock.calls[0][2]).toBe("@decohere/cli@0.0.1-dev.79");
		expect(run.mock.calls[0]).not.toContain("--userconfig");
	});

	it("treats E403 already-published as skip and does not forward NODE_AUTH_TOKEN to npm publish", async () => {
		seedPublishedPackage();
		process.env.NODE_AUTH_TOKEN = "read-token";
		run.mockRejectedValueOnce(new InteropError("404 Not Found"));
		run.mockRejectedValueOnce(
			new InteropError(
				"npm error 403 Forbidden - You cannot publish over the previously published versions: 0.0.1-dev.79",
			),
		);
		const result = await new Npm().publish("/pkg", { channel: "dev", skipIfPublished: true });
		expect(result.message).toMatch(/Skipping publish/);
		expect(run).toHaveBeenCalledTimes(2);
		const publishCall = run.mock.calls[1];
		expect(publishCall[1]).toBe("publish");
		expect(publishCall[0].env.NODE_AUTH_TOKEN).toBeUndefined();
		expect(publishCall[0].env.NPM_TOKEN).toBeUndefined();
		expect(publishCall[0].env.NPM_CONFIG_USERCONFIG).toBe("/dev/null");
	});

	it("publish passes otp via env, not argv", async () => {
		await new Npm().publish("dist/release/pkg", {
			channel: "beta",
			dryRun: true,
			otp: "123456",
		});
		expect(run).toHaveBeenCalledWith(
			expect.objectContaining({ cwd: undefined, env: expect.any(Object) }),
			"publish",
			"./dist/release/pkg",
			"--tag",
			"beta",
			"--dry-run",
		);
		const env = run.mock.calls[0][0].env as NodeJS.ProcessEnv;
		expect(env.NPM_CONFIG_OTP).toBe("123456");
		expect(env.NODE_AUTH_TOKEN).toBeUndefined();
		expect(env.NPM_CONFIG_USERCONFIG).toBe("/dev/null");
		const argv = run.mock.calls[0]?.slice(1) ?? [];
		expect(argv).not.toContain("--otp");
		expect(argv).not.toContain("123456");
	});
});
