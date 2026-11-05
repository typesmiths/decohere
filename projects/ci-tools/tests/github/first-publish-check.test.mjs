import { describe, expect, it } from "vitest";
import { checkFirstPublish } from "../../src/github/first-publish-check.mjs";

function fakeRegistry(statusByName) {
	return async (url) => {
		const name = decodeURIComponent(new URL(url).pathname.slice(1));
		return new Response("{}", { status: statusByName[name] ?? 200 });
	};
}

async function check(statusByName, blocking) {
	const messages = [];
	const code = await checkFirstPublish({
		packages: ["@decohere/cli", "@decohere/shiny"],
		blocking,
		fetch: fakeRegistry(statusByName),
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

	it("doesn't mistake an npm outage for a new package", async () => {
		await expect(check({ "@decohere/shiny": 503 }, false)).rejects.toThrow(
			"Could not check @decohere/shiny on npm: 503",
		);
	});
});
