import { vol } from "memfs";
import { afterEach, describe, expect, it } from "vitest";
import { runBootstrap } from "../../src/github/npm-bootstrap.mjs";

const root = "/workspace";
const LOGIN = "the-secret-login";

function seedWorkspace() {
	vol.fromJSON({
		[`${root}/package.json`]: JSON.stringify({ version: "0.0.1-dev.5" }),
		[`${root}/projects/cli/package.json`]: JSON.stringify({
			name: "@decohere/cli",
			version: "0.0.1-dev.5",
		}),
		[`${root}/projects/http/http-fastify/package.json`]: JSON.stringify({
			name: "@decohere/http-fastify",
			version: "0.0.1-dev.5",
		}),
		[`${root}/projects/scribe/scribe-console/package.json`]: JSON.stringify({
			name: "@decohere/scribe-console",
			version: "0.0.1-dev.5",
		}),
	});
}

const claims = (file) => ({ repository: "typesmiths/decohere", workflow_ref: { file } });
const PUBLISH = {
	id: "p1",
	type: "github",
	claims: { ...claims("publish.yml"), environment: "npm-publish" },
	permissions: ["createPackage"],
};
const PROMOTE = {
	id: "p2",
	type: "github",
	claims: claims("promote-latest.yml"),
	permissions: ["createStagedPackage", "manageDistTags"],
};
const FULL = [PUBLISH, PROMOTE];

/**
 * A fake npm and registry. `packages` maps each name on npm to its Trusted Publishers; a name not
 * in it isn't on npm. npm calls are recorded as their arguments plus the code npm would get through
 * NPM_CONFIG_OTP; registry writes as the name, body and code.
 */
function fakeNpm({ packages = {}, loggedIn = true, failPosting = [] } = {}) {
	const calls = [];
	const posts = [];
	const npm = (args, { otp } = {}) => {
		calls.push(`${args.join(" ")}${otp ? ` [otp ${otp}]` : ""}`);
		if (args[0] === "whoami") return { status: loggedIn ? 0 : 1, output: "" };
		// A first publish creates the name, with no Trusted Publishers yet.
		if (args[0] === "publish") packages[`@decohere/${args[1].split("/").at(-1)}`] = [];
		return { status: 0, output: "" };
	};
	const fetch = async (url, init = {}) => {
		const headers = new Headers(init.headers);
		if (headers.get("authorization") !== `Bearer ${LOGIN}`) {
			return new Response("unauthorized", { status: 401 });
		}
		const trust = /\/-\/package\/(.+)\/trust$/.exec(url);
		const name = decodeURIComponent(trust?.[1] ?? new URL(url).pathname.slice(1));
		if (!(name in packages)) return new Response("not found", { status: 404 });
		if (trust == null) return new Response(JSON.stringify({ name }));
		// Like npm: Trusted Publishers need a code, even to read them.
		if (headers.get("npm-otp") == null) {
			return new Response('{"message":"Unauthorized"}', {
				status: 401,
				headers: { "www-authenticate": "OTP" },
			});
		}
		if (init.method === "POST") {
			if (failPosting.includes(name)) return new Response("denied", { status: 403 });
			posts.push({ name, body: JSON.parse(String(init.body)), otp: headers.get("npm-otp") });
			return new Response("[]");
		}
		return new Response(JSON.stringify(packages[name]));
	};
	return { npm, fetch, calls, posts };
}

async function run(argv, registry) {
	const lines = [];
	const code = await runBootstrap({
		argv,
		root,
		io: {
			npm: registry.npm,
			fetch: registry.fetch,
			token: () => LOGIN,
			log: (line) => lines.push(line),
		},
	});
	return { code, output: lines.join("\n") };
}

afterEach(() => {
	vol.reset();
});

describe("npm-bootstrap", () => {
	it("gives a new package its name and both Trusted Publishers, with one code", async () => {
		seedWorkspace();
		const registry = fakeNpm({
			packages: { "@decohere/cli": FULL, "@decohere/http-fastify": FULL },
		});

		const { code } = await run(["--otp", "123456"], registry);

		expect(code).toBe(0);
		expect(registry.calls).toEqual([
			"whoami",
			"publish ./projects/scribe/scribe-console --access public --tag dev [otp 123456]",
			"trust github @decohere/scribe-console --file publish.yml --repo typesmiths/decohere --env npm-publish --allow-publish --yes [otp 123456]",
		]);
		expect(registry.posts).toEqual([
			{
				name: "@decohere/scribe-console",
				otp: "123456",
				body: [{ type: "github", claims: PROMOTE.claims, permissions: PROMOTE.permissions }],
			},
		]);
	});

	// http-fastify: its name was made by hand, with no Trusted Publisher.
	it("sets up a name that is on npm but has no Trusted Publishers, without publishing it", async () => {
		seedWorkspace();
		const registry = fakeNpm({
			packages: {
				"@decohere/cli": FULL,
				"@decohere/http-fastify": [],
				"@decohere/scribe-console": FULL,
			},
		});

		const { code, output } = await run(["--otp", "1"], registry);

		expect(code).toBe(0);
		expect(registry.calls).toEqual([
			"whoami",
			"trust github @decohere/http-fastify --file publish.yml --repo typesmiths/decohere --env npm-publish --allow-publish --yes [otp 1]",
		]);
		expect(registry.posts.map((post) => post.name)).toEqual(["@decohere/http-fastify"]);
		expect(output).toContain("name is on npm: skip the first publish");
	});

	it("adds only the promote publisher to a package that has the publish one", async () => {
		seedWorkspace();
		const registry = fakeNpm({
			packages: {
				"@decohere/cli": FULL,
				"@decohere/http-fastify": [PUBLISH],
				"@decohere/scribe-console": FULL,
			},
		});

		const { code, output } = await run(["--otp", "1"], registry);

		expect(code).toBe(0);
		expect(registry.calls).toEqual(["whoami"]);
		expect(registry.posts.map((post) => post.name)).toEqual(["@decohere/http-fastify"]);
		expect(output).toContain("Trusted Publisher for publish.yml is set: skip");
	});

	it("changes nothing when every package is set up", async () => {
		seedWorkspace();
		const registry = fakeNpm({
			packages: {
				"@decohere/cli": FULL,
				"@decohere/http-fastify": FULL,
				"@decohere/scribe-console": FULL,
			},
		});

		const { code, output } = await run(["--otp", "1"], registry);

		expect(code).toBe(0);
		expect(registry.calls).toEqual(["whoami"]);
		expect(registry.posts).toEqual([]);
		expect(output).toBe("Nothing to do: 3 packages can be published and promoted from CI.");
	});

	it("works only on the packages named", async () => {
		seedWorkspace();
		const registry = fakeNpm({
			packages: { "@decohere/cli": FULL, "@decohere/http-fastify": [] },
		});

		await run(["--otp", "1", "@decohere/http-fastify"], registry);

		expect(registry.calls.join("\n")).not.toContain("scribe-console");
		expect(registry.posts.map((post) => post.name)).toEqual(["@decohere/http-fastify"]);
	});

	it("says where to set up the promote publisher when no package has one, changing nothing", async () => {
		seedWorkspace();
		const registry = fakeNpm({
			packages: { "@decohere/cli": [PUBLISH], "@decohere/http-fastify": [PUBLISH] },
		});

		const { code, output } = await run(["--otp", "1"], registry);

		expect(code).toBe(1);
		expect(output).toContain("Allow npm dist-tag on");
		expect(registry.calls).toEqual(["whoami"]);
		expect(registry.posts).toEqual([]);
	});

	it("stops, saying to run it again, when the registry refuses a change", async () => {
		seedWorkspace();
		const registry = fakeNpm({
			packages: {
				"@decohere/cli": FULL,
				"@decohere/http-fastify": [PUBLISH],
				"@decohere/scribe-console": FULL,
			},
			failPosting: ["@decohere/http-fastify"],
		});

		const { code, output } = await run(["--otp", "1"], registry);

		expect(code).toBe(1);
		expect(output).toContain("403 denied. Run this again with a new code.");
	});

	/** `npm trust` rejects `--otp`: the code goes through the environment. */
	it("never passes the code as an argument, and gives it to the registry", async () => {
		seedWorkspace();
		const registry = fakeNpm({ packages: { "@decohere/cli": FULL } });

		await run(["--otp", "604381"], registry);

		expect(registry.calls.join("\n")).not.toContain("--otp");
		expect(registry.posts.map((post) => post.otp)).toEqual(["604381", "604381"]);
	});

	// npm wants a code even to read Trusted Publishers.
	it("asks for a code before reading anything", async () => {
		seedWorkspace();
		const registry = fakeNpm({ packages: { "@decohere/cli": FULL } });

		const { code, output } = await run([], registry);

		expect(code).toBe(1);
		expect(output).toContain("--otp <code>");
		expect(registry.calls).toEqual(["whoami"]);
	});

	it("prints what it would do on a dry run, changing nothing", async () => {
		seedWorkspace();
		const registry = fakeNpm({
			packages: { "@decohere/cli": FULL, "@decohere/http-fastify": [] },
		});

		const { code, output } = await run(["--dry-run", "--otp", "1"], registry);

		expect(code).toBe(0);
		expect(registry.calls).toEqual(["whoami"]);
		expect(registry.posts).toEqual([]);
		expect(output).toContain(
			"[dry run] npm publish ./projects/scribe/scribe-console --access public --tag dev",
		);
		expect(output).toContain(
			"[dry run] copy the Trusted Publisher for promote-latest.yml to @decohere/http-fastify",
		);
	});

	it("stops when not logged in, or for a name that is not a package", async () => {
		seedWorkspace();
		const loggedOut = fakeNpm({ loggedIn: false });
		expect((await run(["--otp", "1"], loggedOut)).code).toBe(1);
		expect(loggedOut.calls).toEqual(["whoami"]);

		const typo = fakeNpm();
		const { code, output } = await run(["--otp", "1", "@decohere/scribe-consol"], typo);
		expect(code).toBe(1);
		expect(output).toBe("Not a publishable package in projects/: @decohere/scribe-consol");
	});

	it("never prints the login", async () => {
		seedWorkspace();
		const registry = fakeNpm({
			packages: { "@decohere/cli": FULL, "@decohere/http-fastify": [PUBLISH] },
			failPosting: ["@decohere/http-fastify"],
		});

		const { output } = await run(["--otp", "1"], registry);

		expect(output).not.toContain(LOGIN);
	});
});
