import { describe, expect, it } from "vitest";
import { copyPromoteTrust } from "../../src/github/npm-trust-promote.mjs";

const PROMOTE_ENTRY = {
	id: "abc",
	type: "github",
	claims: { repository: "typesmiths/decohere", workflow_ref: { file: "promote-latest.yml" } },
	permissions: ["createStagedPackage", "manageDistTags"],
};
const PUBLISH_ENTRY = {
	id: "def",
	type: "github",
	claims: { repository: "typesmiths/decohere", workflow_ref: { file: "publish.yml" } },
	permissions: ["createPackage"],
};

function fakeRegistry(start: Record<string, object[]>, failPosting: string[] = []) {
	const posts: { name: string; body: unknown; otp: string | null }[] = [];
	const fetch = async (url: string, init?: RequestInit) => {
		const name = decodeURIComponent(/package\/(.+)\/trust$/.exec(url)?.[1] ?? "");
		const headers = new Headers(init?.headers);
		if (init?.method === "POST") {
			if (failPosting.includes(name)) return new Response("denied", { status: 403 });
			posts.push({ name, body: JSON.parse(String(init.body)), otp: headers.get("npm-otp") });
			return new Response("[]");
		}
		return new Response(JSON.stringify(start[name] ?? []));
	};
	return { fetch: fetch as unknown as typeof globalThis.fetch, posts };
}

async function copy(registry: ReturnType<typeof fakeRegistry>, packages: string[]) {
	const messages: string[] = [];
	const code = await copyPromoteTrust({
		packages,
		from: "@decohere/cli",
		token: "the-secret-login",
		otp: "123456",
		fetch: registry.fetch,
		log: (message: string) => messages.push(message),
	});
	return { code, output: messages.join("\n") };
}

describe("copyPromoteTrust", () => {
	it("copies the entry to the other packages, without its id", async () => {
		const registry = fakeRegistry({
			"@decohere/cli": [PUBLISH_ENTRY, PROMOTE_ENTRY],
			"@decohere/core": [PUBLISH_ENTRY],
		});

		const { code } = await copy(registry, ["@decohere/cli", "@decohere/core"]);

		expect(code).toBe(0);
		expect(registry.posts).toEqual([
			{
				name: "@decohere/core",
				otp: "123456",
				body: [
					{
						type: "github",
						claims: PROMOTE_ENTRY.claims,
						permissions: ["createStagedPackage", "manageDistTags"],
					},
				],
			},
		]);
	});

	it("says which page to set up, and changes nothing, when the source has no entry", async () => {
		const registry = fakeRegistry({ "@decohere/cli": [PUBLISH_ENTRY] });

		const { code, output } = await copy(registry, ["@decohere/cli", "@decohere/core"]);

		expect(code).toBe(1);
		expect(output).toContain("Allow npm dist-tag on");
		expect(output).toContain("--from");
		expect(registry.posts).toEqual([]);
	});

	it("skips packages already set up, so it can run again", async () => {
		const registry = fakeRegistry({
			"@decohere/cli": [PROMOTE_ENTRY],
			"@decohere/core": [PROMOTE_ENTRY],
		});

		const { code, output } = await copy(registry, ["@decohere/cli", "@decohere/core"]);

		expect(code).toBe(0);
		expect(output).toContain("already set: @decohere/core");
		expect(registry.posts).toEqual([]);
	});

	it("finishes the rest when one fails, then fails naming it", async () => {
		const registry = fakeRegistry({ "@decohere/cli": [PROMOTE_ENTRY] }, ["@decohere/core"]);

		const { code, output } = await copy(registry, [
			"@decohere/cli",
			"@decohere/core",
			"@decohere/http",
		]);

		expect(code).toBe(1);
		expect(output).toContain("@decohere/core: 403 denied");
		expect(registry.posts.map((post) => post.name)).toEqual(["@decohere/http"]);
	});

	it("never prints the login", async () => {
		const registry = fakeRegistry({ "@decohere/cli": [PROMOTE_ENTRY] }, ["@decohere/core"]);

		const { output } = await copy(registry, ["@decohere/cli", "@decohere/core"]);

		expect(output).not.toContain("the-secret-login");
	});
});
