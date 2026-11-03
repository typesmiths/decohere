import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { runCreateLauncherSmoke } from "../../src/github/smoke-create-launcher.mjs";

const fs = await vi.importActual("node:fs");
const PUBLISH_YML = fileURLToPath(
	new URL("../../../../.github/workflows/publish.yml", import.meta.url),
);

describe("runCreateLauncherSmoke", () => {
	it("execs npx from a temp directory, not the repo root", () => {
		/** @type {{ cmd: string, args: string[], opts: { cwd?: string } }[]} */
		const calls = [];
		const written = [];

		const result = runCreateLauncherSmoke({
			createVersion: "0.0.1-dev.80",
			authToken: "tok",
			tmpdir: () => "/tmp",
			mkdtempSync: (prefix) => `${prefix}abc`,
			writeFileSync: (path, body) => {
				written.push({ path, body });
			},
			spawnSync: (cmd, args, opts) => {
				calls.push({ cmd, args, opts });
				return { status: 0 };
			},
			stdio: "pipe",
		});

		expect(result.workDir).toBe("/tmp/decohere-create-smoke-abc");
		expect(result.workDir).not.toBe(process.cwd());
		expect(calls).toHaveLength(1);
		expect(calls[0].cmd).toBe("npx");
		expect(calls[0].args).toEqual(["--yes", "@decohere/create@0.0.1-dev.80", "--help"]);
		expect(calls[0].opts.cwd).toBe("/tmp/decohere-create-smoke-abc");
		expect(calls[0].opts.cwd).not.toBe(process.cwd());
		expect(written).toEqual([
			{
				path: "/tmp/decohere-create-smoke-abc/.npmrc",
				body: "@decohere:registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=tok\n",
			},
		]);
	});

	it("fails closed without version or token", () => {
		expect(() => runCreateLauncherSmoke({ createVersion: "", authToken: "tok" })).toThrow(
			"CREATE_VERSION is required",
		);
		expect(() =>
			runCreateLauncherSmoke({ createVersion: "0.0.1-dev.80", authToken: "" }),
		).toThrow("NODE_AUTH_TOKEN is required");
	});
});

describe("publish.yml create smoke + tag", () => {
	const yml = fs.readFileSync(PUBLISH_YML, "utf8");

	it("wires create smoke through the isolated launcher", () => {
		expect(yml).toContain("node projects/ci-tools/src/github/smoke-create-launcher.mjs");
		expect(yml).toContain("CREATE_VERSION:");
		expect(yml).not.toContain("npx --yes");
	});

	it("grants the tag job actions:read so publish-prepare can download CI artifacts", () => {
		const tag = yml.slice(yml.indexOf("\n  tag:"));
		const perms = tag.slice(tag.indexOf("permissions:"), tag.indexOf("steps:"));
		expect(perms).toMatch(/contents:\s*write/);
		expect(perms).toMatch(/actions:\s*read/);
	});
});
