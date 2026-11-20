import { describe, expect, it } from "vitest";
import { checkFirstPublish } from "../../src/github/first-publish-check.mjs";

/** A version Publish made: npm attaches a provenance attestation to it. */
const FROM_CI = {
	"0.0.1-dev.6": {
		dist: { attestations: { url: "https://registry.npmjs.org/-/npm/v1/attestations/x" } },
	},
};
/** A version an owner published by hand. */
const BY_HAND = { "0.0.1-dev.5": { dist: {} } };

/** Each name answers with its status, and its versions (Publish's by default). */
function fakeRegistry(statusByName, versionsByName = {}) {
	return async (url) => {
		const name = decodeURIComponent(new URL(url).pathname.slice(1));
		const versions = versionsByName[name] ?? FROM_CI;
		return new Response(JSON.stringify({ name, versions }), {
			status: statusByName[name] ?? 200,
		});
	};
}

async function check(statusByName, blocking, versionsByName) {
	const messages = [];
	const code = await checkFirstPublish({
		packages: ["@decohere/cli", "@decohere/shiny"],
		blocking,
		fetch: fakeRegistry(statusByName, versionsByName),
		log: (message) => messages.push(message),
	});
	return { code, output: messages.join("\n") };
}

describe("checkFirstPublish", () => {
	it("passes when every package is on npm", async () => {
		const { code, output } = await check({}, true);

		expect(code).toBe(0);
		expect(output).toContain("All 2 packages are on npm");
	});

	it("only leaves a notice on a PR, so a contributor can propose a package", async () => {
		const { code, output } = await check({ "@decohere/shiny": 404 }, false);

		expect(code).toBe(0);
		expect(output).toContain("::notice::");
		expect(output).toContain("pnpm npm:bootstrap --otp <code> @decohere/shiny");
	});

	it("fails in the merge queue, naming the package and the command", async () => {
		const { code, output } = await check({ "@decohere/shiny": 404 }, true);

		expect(code).toBe(1);
		expect(output).toContain("::error::");
		expect(output).toContain("pnpm npm:bootstrap --otp <code> @decohere/shiny");
	});

	// How @decohere/http-fastify got through: its name was made by hand, with no Trusted Publisher.
	it("warns, without failing, about a name on npm that Publish has never published", async () => {
		const { code, output } = await check({}, true, { "@decohere/shiny": { ...BY_HAND } });

		expect(code).toBe(0);
		expect(output).toContain("::warning::");
		expect(output).toContain("@decohere/shiny");
		expect(output).toContain("pnpm npm:bootstrap --otp <code> @decohere/shiny");
		expect(output).not.toContain("@decohere/cli");
	});

	it("doesn't mistake an npm outage for a new package", async () => {
		await expect(check({ "@decohere/shiny": 503 }, false)).rejects.toThrow(
			"Could not check @decohere/shiny on npm: 503",
		);
	});
});
