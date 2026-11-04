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
		const npx = calls.at(-1);
		expect(npx.cmd).toBe("npx");
		expect(npx.args).toEqual(["--yes", "@decohere/create@0.0.1-dev.80", "--help"]);
		expect(npx.opts.cwd).toBe("/tmp/decohere-create-smoke-abc");
		expect(npx.opts.cwd).not.toBe(process.cwd());
		expect(written).toEqual([
			{
				path: "/tmp/decohere-create-smoke-abc/.npmrc",
				body: "@decohere:registry=https://registry.npmjs.org/\n",
			},
		]);
		// The packages are public: the smoke installs them the way a user does, with no token.
		expect(npx.opts.env.NODE_AUTH_TOKEN).toBeUndefined();
	});

	// npm's public cache can lag minutes behind a publish: the first token-free Publish ran npx
	// 90 seconds after publishing and got ETARGET for a version the registry already had.
	it("waits until npm serves the new version before running npx", () => {
		/** @type {{ cmd: string, args: string[] }[]} */
		const calls = [];
		const sleeps = [];
		let views = 0;

		const result = runCreateLauncherSmoke({
			createVersion: "0.0.1-dev.127",
			tmpdir: () => "/tmp",
			mkdtempSync: (prefix) => `${prefix}abc`,
			writeFileSync: () => {},
			spawnSync: (cmd, args) => {
				calls.push({ cmd, args });
				if (cmd === "npm") return { status: ++views < 3 ? 1 : 0 };
				return { status: 0 };
			},
			sleep: (ms) => sleeps.push(ms),
			stdio: "pipe",
		});

		expect(result.status).toBe(0);
		expect(calls.map((call) => call.cmd)).toEqual(["npm", "npm", "npm", "npx"]);
		expect(calls[0].args).toEqual(["view", "@decohere/create@0.0.1-dev.127", "version"]);
		expect(sleeps).toHaveLength(2);
	});

	it("fails without running npx when npm never serves the version", () => {
		/** @type {string[]} */
		const commands = [];

		const result = runCreateLauncherSmoke({
			createVersion: "0.0.1-dev.127",
			tmpdir: () => "/tmp",
			mkdtempSync: (prefix) => `${prefix}abc`,
			writeFileSync: () => {},
			spawnSync: (cmd) => {
				commands.push(cmd);
				return { status: 1 };
			},
			sleep: () => {},
			attempts: 3,
			stdio: "pipe",
		});

		expect(result.status).toBe(1);
		expect(commands).toEqual(["npm", "npm", "npm"]);
	});

	it("fails closed without a version", () => {
		expect(() => runCreateLauncherSmoke({ createVersion: "" })).toThrow(
			"CREATE_VERSION is required",
		);
	});
});

describe("publish.yml create smoke + tag", () => {
	const yml = fs.readFileSync(PUBLISH_YML, "utf8");

	it("wires create smoke through the isolated launcher", () => {
		expect(yml).toContain("node projects/ci-tools/src/github/smoke-create-launcher.mjs");
		expect(yml).toContain("CREATE_VERSION:");
		expect(yml).not.toContain("npx --yes");
	});

	it("reads npm without a token: the packages are public and publishing is OIDC", () => {
		const workflows = fileURLToPath(new URL("../../../../.github/", import.meta.url));
		const files = fs
			.readdirSync(workflows, { recursive: true })
			.filter((file) => /\.ya?ml$/.test(file));
		expect(files.length).toBeGreaterThan(0);
		for (const file of files) {
			expect(fs.readFileSync(`${workflows}${file}`, "utf8"), file).not.toMatch(
				/NODE_AUTH_TOKEN|_authToken/,
			);
		}
	});

	it("grants the tag job actions:read so publish-prepare can download CI artifacts", () => {
		const tag = yml.slice(yml.indexOf("\n  tag:"));
		const perms = tag.slice(tag.indexOf("permissions:"), tag.indexOf("steps:"));
		expect(perms).toMatch(/contents:\s*write/);
		expect(perms).toMatch(/actions:\s*read/);
	});
});
