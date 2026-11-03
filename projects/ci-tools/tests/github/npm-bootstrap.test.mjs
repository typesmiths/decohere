import { vol } from "memfs";
import { afterEach, describe, expect, it } from "vitest";
import { runBootstrap } from "../../src/github/npm-bootstrap.mjs";

const root = "/workspace";

function seedWorkspace() {
	vol.fromJSON({
		[`${root}/package.json`]: JSON.stringify({ version: "0.0.1-dev.5" }),
		[`${root}/projects/scribe/scribe/package.json`]: JSON.stringify({
			name: "@decohere/scribe",
			version: "0.0.1-dev.5",
		}),
		[`${root}/projects/scribe/scribe-console/package.json`]: JSON.stringify({
			name: "@decohere/scribe-console",
			version: "0.0.1-dev.5",
		}),
	});
}

/**
 * A fake registry: `published` names exist, and `trusted` names have a Trusted
 * Publisher. Each call is recorded as its arguments, plus the code npm would
 * get through NPM_CONFIG_OTP.
 */
function fakeNpm({ published = [], trusted = [], loggedIn = true } = {}) {
	const calls = [];
	const npm = (args, { otp } = {}) => {
		calls.push(`${args.join(" ")}${otp ? ` [otp ${otp}]` : ""}`);
		if (args[0] === "whoami") {
			return { status: loggedIn ? 0 : 1, output: "" };
		}
		if (args[0] === "trust" && args[1] === "list") {
			return trusted.includes(args[2])
				? { status: 0, output: '[{"repository":"typesmiths/decohere","file":"publish.yml"}]' }
				: { status: 0, output: "[]" };
		}
		return { status: 0, output: "" };
	};
	return { npm, calls, nameExists: (name) => published.includes(name) };
}

function run(argv, registry) {
	const lines = [];
	return runBootstrap({
		argv,
		root,
		io: {
			npm: registry.npm,
			nameExists: registry.nameExists,
			log: (line) => lines.push(line),
		},
	}).then((code) => ({ code, lines }));
}

afterEach(() => {
	vol.reset();
});

describe("npm-bootstrap", () => {
	it("first-publishes unpublished names public, then sets the Trusted Publisher", async () => {
		seedWorkspace();
		const registry = fakeNpm({ published: ["@decohere/scribe"] });

		const { code } = await run(["--otp", "123456"], registry);

		expect(code).toBe(0);
		expect(registry.calls).toEqual([
			"whoami",
			"publish ./projects/scribe/scribe-console --access public --tag dev [otp 123456]",
			"trust list @decohere/scribe-console --json [otp 123456]",
			"trust github @decohere/scribe-console --file publish.yml --repo typesmiths/decohere --env npm-publish --allow-publish --yes [otp 123456]",
		]);
	});

	it("skips the steps that are already done", async () => {
		seedWorkspace();
		const registry = fakeNpm({
			published: ["@decohere/scribe-console"],
			trusted: ["@decohere/scribe-console"],
		});

		const { code } = await run(["@decohere/scribe-console"], registry);

		expect(code).toBe(0);
		expect(registry.calls).toEqual(["whoami", "trust list @decohere/scribe-console --json"]);
	});

	/** `npm trust` rejects `--otp`: the code goes through the environment. */
	it("never passes the code as an argument, and lets npm ask when none is given", async () => {
		seedWorkspace();
		const withCode = fakeNpm({ published: ["@decohere/scribe"] });
		await run(["--otp", "604381"], withCode);
		expect(withCode.calls.join("\n")).not.toContain("--otp");

		const withoutCode = fakeNpm({ published: ["@decohere/scribe"] });
		expect((await run([], withoutCode)).code).toBe(0);
		expect(withoutCode.calls.join("\n")).not.toContain("otp");
	});

	it("prints the commands on a dry run, calling npm only to check the login", async () => {
		seedWorkspace();
		const registry = fakeNpm({ published: ["@decohere/scribe"] });

		const { code, lines } = await run(["--dry-run"], registry);

		expect(code).toBe(0);
		expect(registry.calls).toEqual(["whoami"]);
		expect(lines).toContain(
			"[dry run] npm publish ./projects/scribe/scribe-console --access public --tag dev",
		);
	});

	it("stops when not logged in, or for a name that is not a package", async () => {
		seedWorkspace();
		const loggedOut = fakeNpm({ loggedIn: false });
		expect((await run(["--otp", "1"], loggedOut)).code).toBe(1);
		expect(loggedOut.calls).toEqual(["whoami"]);

		const typo = fakeNpm();
		const { code, lines } = await run(["@decohere/scribe-consol"], typo);
		expect(code).toBe(1);
		expect(lines).toEqual(["Not a publishable package in projects/: @decohere/scribe-consol"]);
	});
});
