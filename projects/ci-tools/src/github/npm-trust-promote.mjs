#!/usr/bin/env node
/**
 * Gives every public @decohere package the Trusted Publisher `promote-latest.yml` needs, by copying
 * it from one package an owner set up on npmjs.com. `npm trust` has no flag for the "Allow npm
 * dist-tag" permission (`manageDistTags` in the registry), so this calls the same registry endpoint
 * it uses. npm doesn't document that endpoint. It only adds entries, and packages that already have
 * one are skipped.
 *
 * Reads the owner's npm login from NPM_TOKEN, and never prints it.
 *
 *   NPM_TOKEN="$(sed -n 's#^//registry.npmjs.org/:_authToken=##p' ~/.npmrc)" \
 *     pnpm npm:trust-promote --otp <code> [--from @decohere/cli]
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { listPublishablePackages } from "./publish-verify.mjs";

export const PROMOTE_WORKFLOW = "promote-latest.yml";
const REGISTRY = "https://registry.npmjs.org";

/**
 * @typedef {{ type?: string, claims?: { workflow_ref?: { file?: string } }, permissions?: string[] }} TrustEntry
 */

/**
 * @param {TrustEntry[]} entries
 * @returns {TrustEntry | undefined}
 */
function findPromoteEntry(entries) {
	return entries.find((entry) => entry.claims?.workflow_ref?.file === PROMOTE_WORKFLOW);
}

/**
 * @param {{
 *   packages: string[],
 *   from: string,
 *   token: string,
 *   otp: string,
 *   fetch: typeof globalThis.fetch,
 *   log?: (message: string) => void,
 * }} options
 * @returns {Promise<number>} exit code
 */
export async function copyPromoteTrust(options) {
	const { packages, from, token, otp, fetch } = options;
	const log = options.log ?? console.log;
	const headers = {
		authorization: `Bearer ${token}`,
		"npm-otp": otp,
		"content-type": "application/json",
	};
	const trustUrl = (name) => `${REGISTRY}/-/package/${name.replace("/", "%2f")}/trust`;

	const list = async (name) => {
		const response = await fetch(trustUrl(name), { headers });
		if (!response.ok) {
			throw new Error(`reading ${name}: ${response.status} ${await response.text()}`);
		}
		return /** @type {TrustEntry[]} */ (await response.json());
	};

	let source;
	try {
		source = findPromoteEntry(await list(from));
	} catch (error) {
		log(`Nothing changed. ${String(error)}`);
		return 1;
	}
	if (source == null) {
		log(
			`${from} has no Trusted Publisher for ${PROMOTE_WORKFLOW}. On npmjs.com, in its settings, add ` +
				`one: GitHub Actions, organization typesmiths, repository decohere, workflow ${PROMOTE_WORKFLOW}, ` +
				"no environment, Allow npm publish off, Allow npm dist-tag on. Then run this again. " +
				"If you set it up on another package, pass that one with --from. Nothing changed.",
		);
		return 1;
	}
	log(`Copying from ${from}, with permissions: ${(source.permissions ?? []).join(", ")}`);

	const entry = { type: source.type, claims: source.claims, permissions: source.permissions };
	const others = packages.filter((name) => name !== from);
	const failures = [];
	// All at once, so one OTP code covers them before it expires.
	await Promise.all(
		others.map(async (name) => {
			try {
				if (findPromoteEntry(await list(name)) != null) {
					log(`already set: ${name}`);
					return;
				}
				const response = await fetch(trustUrl(name), {
					method: "POST",
					headers,
					body: JSON.stringify([entry]),
				});
				if (!response.ok) {
					failures.push(`${name}: ${response.status} ${await response.text()}`);
					return;
				}
				log(`set: ${name}`);
			} catch (error) {
				failures.push(`${name}: ${String(error)}`);
			}
		}),
	);

	if (failures.length > 0) {
		log(`Failed:\n${failures.join("\n")}\nRun it again with a new code to finish.`);
		return 1;
	}
	log(`Done: ${packages.length} packages have a Trusted Publisher for ${PROMOTE_WORKFLOW}.`);
	return 0;
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const { values } = parseArgs({
		options: {
			otp: { type: "string" },
			from: { type: "string", default: "@decohere/cli" },
		},
	});
	const token = process.env.NPM_TOKEN;
	if (!token || !values.otp) {
		console.error(
			`Usage: NPM_TOKEN="$(sed -n 's#^//registry.npmjs.org/:_authToken=##p' ~/.npmrc)" pnpm npm:trust-promote --otp <code>`,
		);
		process.exit(1);
	}
	process.exit(
		await copyPromoteTrust({
			packages: listPublishablePackages(resolve(".")).map((pkg) => pkg.name),
			from: values.from,
			token,
			otp: values.otp,
			fetch: globalThis.fetch,
		}),
	);
}
