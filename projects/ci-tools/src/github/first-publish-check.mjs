#!/usr/bin/env node
/**
 * Finds packages in this workspace that aren't on npm yet. A first publish needs an owner's npm
 * login, so CI can't do it. On a PR that's only a notice, so a contributor can propose a package
 * with no npm access. In the merge queue it fails, because Publish could not upload that package.
 *
 * A name on npm that Publish has never published may lack its Trusted Publishers, which only a
 * logged-in owner can see. That gets a warning, not a failure: a package an owner has just set up
 * has no version from Publish either, until it merges.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { listPublishablePackages } from "./publish-verify.mjs";

const REGISTRY = "https://registry.npmjs.org";

/**
 * Publish runs on GitHub Actions with provenance, so npm keeps an attestation for each version it
 * publishes; a version an owner published by hand has none.
 *
 * @param {{ versions?: Record<string, { dist?: { attestations?: unknown } }> }} packument
 */
function publishedFromCi(packument) {
	return Object.values(packument.versions ?? {}).some(
		(version) => version.dist?.attestations != null,
	);
}

/**
 * @param {{
 *   packages: string[],
 *   blocking: boolean,
 *   fetch: typeof globalThis.fetch,
 *   log?: (message: string) => void,
 * }} options
 * @returns {Promise<number>} exit code
 */
export async function checkFirstPublish(options) {
	const { packages, blocking, fetch } = options;
	const log = options.log ?? console.log;

	const results = await Promise.all(
		packages.map(async (name) => {
			// Not /-/package/<name>/dist-tags: for a name that does not exist it answers 401, not 404.
			const url = `${REGISTRY}/${name.replace("/", "%2f")}`;
			const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
			// Anything else, like an outage, says nothing about whether the name exists.
			if (!response.ok && response.status !== 404) {
				throw new Error(`Could not check ${name} on npm: ${response.status}`);
			}
			if (response.status === 404) {
				return { name, missing: true, fromCi: false };
			}
			return { name, missing: false, fromCi: publishedFromCi(await response.json()) };
		}),
	);

	const neverFromCi = results
		.filter((result) => !result.missing && !result.fromCi)
		.map((result) => result.name);
	if (neverFromCi.length > 0) {
		const names = neverFromCi.join(" ");
		log(
			`::warning::On npm, but never published by Publish: ${names}. Unless an owner has run ` +
				`\`pnpm npm:bootstrap --otp <code> ${names}\`, it may have no Trusted Publisher, and Publish will fail on it.`,
		);
	}

	const missing = results.filter((result) => result.missing).map((result) => result.name);
	if (missing.length === 0) {
		log(`All ${packages.length} packages are on npm.`);
		return 0;
	}
	const names = missing.join(" ");
	if (blocking) {
		log(
			`::error::Not on npm yet: ${names}. An owner runs \`pnpm npm:bootstrap --otp <code> ${names}\`, ` +
				"then adds this PR to the merge queue again.",
		);
		return 1;
	}
	log(
		`::notice::New package, not on npm yet: ${names}. Contributors have nothing to do: a maintainer ` +
			`runs \`pnpm npm:bootstrap --otp <code> ${names}\` before this merges.`,
	);
	return 0;
}

if (
	process.argv[1] != null &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	process.exit(
		await checkFirstPublish({
			packages: listPublishablePackages(process.cwd()).map((pkg) => pkg.name),
			blocking: process.env.GITHUB_EVENT_NAME === "merge_group",
			fetch: globalThis.fetch,
		}),
	);
}
