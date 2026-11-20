/**
 * Sets up npm so CI can publish and promote every package: the name exists, `publish.yml` is a
 * Trusted Publisher (to publish), and `promote-latest.yml` is one (to move `latest`, with only the
 * dist-tag permission). Run it after adding a package, or any time: each step is skipped when it is
 * already done, so with nothing to do it changes nothing.
 *
 *   npm login
 *   pnpm npm:bootstrap --otp <code> [--dry-run] [--channel dev] [<package-name>...]
 *
 * Without names: every publishable package. Everything is read first, in parallel, and then only
 * the missing steps run, so one OTP code (about 30 seconds) can cover them. npm wants the code even
 * to read a package's Trusted Publishers, so it is required, also for `--dry-run`.
 *
 * The first publish and the `publish.yml` publisher go through npm's CLI. The `promote-latest.yml`
 * publisher is copied from a package that has it, through the registry endpoint `npm trust` uses,
 * because `npm trust` has no flag for the dist-tag permission (`manageDistTags`). npm doesn't
 * document that endpoint. The calls use the npm login in the user's npmrc, which is never printed.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { listPublishablePackages } from "./publish-verify.mjs";

const REGISTRY = "https://registry.npmjs.org";
const REPOSITORY = "typesmiths/decohere";

/** The Trusted Publisher that publishes: `publish.yml`'s npm job. */
export const PUBLISH_WORKFLOW = "publish.yml";
const PUBLISH_ENVIRONMENT = "npm-publish";
/** The Trusted Publisher that moves `latest`: `promote-latest.yml`, dist-tags only. */
export const PROMOTE_WORKFLOW = "promote-latest.yml";

/**
 * @typedef {{ type?: string, claims?: { repository?: string, workflow_ref?: { file?: string } }, permissions?: string[] }} TrustEntry
 * @typedef {{ name: string, dir: string, version?: string }} Package
 * @typedef {{ capture?: boolean, otp?: string }} NpmOptions
 * `capture` keeps stdout to read it (npm can then not prompt for 2FA); otherwise npm owns the terminal.
 * @typedef {(args: string[], options?: NpmOptions) => { status: number, output: string }} Npm
 */

/** @param {string | undefined} version */
export function needsPrereleaseTag(version) {
	return String(version ?? "").includes("-");
}

/**
 * npm arguments for a name-only first publish. Scoped names default to restricted,
 * so `--access public`. `./` stops npm reading the path as a GitHub `owner/repo`.
 *
 * @param {Package} pkg
 * @param {string} channel
 */
export function publishArgs(pkg, channel) {
	const tag = needsPrereleaseTag(pkg.version) ? ["--tag", channel] : [];
	return ["publish", `./projects/${pkg.dir}`, "--access", "public", ...tag];
}

/** @param {string} name */
export function trustArgs(name) {
	return [
		"trust",
		"github",
		name,
		"--file",
		PUBLISH_WORKFLOW,
		"--repo",
		REPOSITORY,
		"--env",
		PUBLISH_ENVIRONMENT,
		"--allow-publish",
		"--yes",
	];
}

/**
 * @param {TrustEntry[]} entries
 * @param {string} workflow
 */
function findEntry(entries, workflow) {
	return entries.find(
		(entry) =>
			entry.claims?.workflow_ref?.file === workflow && entry.claims?.repository === REPOSITORY,
	);
}

/** @param {string} name */
const encoded = (name) => name.replace("/", "%2f");

/**
 * The registry calls, as the logged-in owner.
 *
 * @param {{ token: string, otp?: string, fetch: typeof globalThis.fetch }} options
 */
function registry({ token, otp, fetch }) {
	const headers = {
		authorization: `Bearer ${token}`,
		"content-type": "application/json",
		...(otp ? { "npm-otp": otp } : {}),
	};
	const trustUrl = (/** @type {string} */ name) =>
		`${REGISTRY}/-/package/${encoded(name)}/trust`;
	return {
		/** @param {string} name */
		async exists(name) {
			const response = await fetch(`${REGISTRY}/${encoded(name)}`, { headers });
			if (response.status === 404) return false;
			if (!response.ok) throw new Error(`reading ${name}: ${response.status}`);
			return true;
		},
		/** @param {string} name @returns {Promise<TrustEntry[]>} */
		async trust(name) {
			const response = await fetch(trustUrl(name), { headers });
			if (!response.ok) {
				throw new Error(
					`reading ${name}'s Trusted Publishers: ${response.status} ${await response.text()}`,
				);
			}
			return response.json();
		},
		/** @param {string} name @param {TrustEntry} entry */
		async addTrust(name, entry) {
			const body = [
				{ type: entry.type, claims: entry.claims, permissions: entry.permissions },
			];
			const response = await fetch(trustUrl(name), {
				method: "POST",
				headers,
				body: JSON.stringify(body),
			});
			return response.ok ? null : `${response.status} ${await response.text()}`;
		},
	};
}

/** @param {string[]} args @param {NpmOptions} [options] */
function runNpm(args, { capture = false, otp } = {}) {
	const result = spawnSync("npm", args, {
		encoding: "utf8",
		stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
		env: otp ? { ...process.env, NPM_CONFIG_OTP: otp } : process.env,
	});
	return { status: result.status ?? 1, output: result.stdout ?? "" };
}

/**
 * The login `npm login` saved. npm won't print it (`npm config get` refuses), so it is read from
 * the user's npmrc.
 *
 * @param {Npm} npm
 * @returns {string | undefined}
 */
function readLoginToken(npm) {
	const userconfig = npm(["config", "get", "userconfig"], { capture: true }).output.trim();
	if (userconfig.length === 0) return undefined;
	const npmrc = readFileSync(userconfig, "utf8");
	return /^\/\/registry\.npmjs\.org\/:_authToken=(.+)$/m.exec(npmrc)?.[1]?.trim();
}

/**
 * @param {{
 *   argv?: string[],
 *   root?: string,
 *   io?: {
 *     npm?: Npm,
 *     fetch?: typeof globalThis.fetch,
 *     token?: () => string | undefined,
 *     log?: (line: string) => void,
 *   },
 * }} [options]
 * @returns {Promise<number>} exit code
 */
export async function runBootstrap(options = {}) {
	const { values, positionals } = parseArgs({
		args: options.argv ?? process.argv.slice(2),
		options: {
			otp: { type: "string" },
			"dry-run": { type: "boolean", default: false },
			channel: { type: "string", default: "dev" },
		},
		allowPositionals: true,
	});
	const io = options.io ?? {};
	const npm = io.npm ?? runNpm;
	const log = io.log ?? ((line) => process.stdout.write(`${line}\n`));
	const dryRun = values["dry-run"];
	const otp = values.otp;

	const token =
		npm(["whoami"], { capture: true }).status === 0
			? (io.token ?? (() => readLoginToken(npm)))()
			: undefined;
	if (token == null) {
		log("Not logged in to npm: run `npm login` first.");
		return 1;
	}

	if (otp == null) {
		log(
			"Pass a code from your authenticator: pnpm npm:bootstrap --otp <code>. npm wants one even to read Trusted Publishers.",
		);
		return 1;
	}

	const publishable = listPublishablePackages(options.root ?? process.cwd());
	const unknown = positionals.filter((name) => !publishable.some((pkg) => pkg.name === name));
	if (unknown.length > 0) {
		log(`Not a publishable package in projects/: ${unknown.join(", ")}`);
		return 1;
	}
	const chosen =
		positionals.length > 0
			? publishable.filter((pkg) => positionals.includes(pkg.name))
			: publishable;

	// Every package is read, not only the chosen ones: the promote publisher is copied from one that has it.
	const npmRegistry = registry({ token, otp, fetch: io.fetch ?? globalThis.fetch });
	let state;
	try {
		state = await Promise.all(
			publishable.map(async (pkg) => {
				const exists = await npmRegistry.exists(pkg.name);
				return { pkg, exists, trust: exists ? await npmRegistry.trust(pkg.name) : [] };
			}),
		);
	} catch (error) {
		log(`Nothing changed. ${String(error)}`);
		return 1;
	}

	const plans = state
		.filter(({ pkg }) => chosen.includes(pkg))
		.map(({ pkg, exists, trust }) => ({
			pkg,
			publish: !exists,
			publishTrust: findEntry(trust, PUBLISH_WORKFLOW) == null,
			promoteTrust: findEntry(trust, PROMOTE_WORKFLOW) == null,
		}))
		.filter((plan) => plan.publish || plan.publishTrust || plan.promoteTrust);
	if (plans.length === 0) {
		log(`Nothing to do: ${chosen.length} packages can be published and promoted from CI.`);
		return 0;
	}

	const promoteSource = state
		.map(({ trust }) => findEntry(trust, PROMOTE_WORKFLOW))
		.find((entry) => entry != null);
	if (promoteSource == null && plans.some((plan) => plan.promoteTrust)) {
		log(
			`No package has a Trusted Publisher for ${PROMOTE_WORKFLOW} to copy. On npmjs.com, in the settings of ` +
				`@decohere/cli, add one: GitHub Actions, organization typesmiths, repository decohere, workflow ` +
				`${PROMOTE_WORKFLOW}, no environment, Allow npm publish off, Allow npm dist-tag on. Then run this again. ` +
				"Nothing changed.",
		);
		return 1;
	}

	/** @param {string[]} args */
	const runChange = (args) => {
		if (dryRun) {
			log(`  [dry run] npm ${args.join(" ")}`);
			return true;
		}
		return npm(args, { otp }).status === 0;
	};

	for (const plan of plans) {
		const { pkg } = plan;
		log(`\n${pkg.name} (projects/${pkg.dir}, ${pkg.version})`);

		if (!plan.publish) {
			log("  name is on npm: skip the first publish");
		} else if (!runChange(publishArgs(pkg, values.channel))) {
			log("  first publish failed: stopping");
			return 1;
		}

		if (!plan.publishTrust) {
			log(`  Trusted Publisher for ${PUBLISH_WORKFLOW} is set: skip`);
		} else if (!runChange(trustArgs(pkg.name))) {
			log(`  Trusted Publisher for ${PUBLISH_WORKFLOW} failed: stopping`);
			return 1;
		}

		if (!plan.promoteTrust) {
			log(`  Trusted Publisher for ${PROMOTE_WORKFLOW} is set: skip`);
		} else if (dryRun) {
			log(`  [dry run] copy the Trusted Publisher for ${PROMOTE_WORKFLOW} to ${pkg.name}`);
		} else {
			// Checked above: some package has it.
			const failure = await npmRegistry.addTrust(
				pkg.name,
				/** @type {TrustEntry} */ (promoteSource),
			);
			if (failure != null) {
				log(
					`  Trusted Publisher for ${PROMOTE_WORKFLOW} failed: ${failure}. Run this again with a new code.`,
				);
				return 1;
			}
			log(`  Trusted Publisher for ${PROMOTE_WORKFLOW}: set`);
		}
	}

	if (dryRun) return 0;
	log(
		"\nDone: these packages can be published and promoted from CI. If Publish already failed on one, " +
			"rerun it: `gh run rerun --failed <run-id>`. Otherwise add the PR to the merge queue.",
	);
	return 0;
}

const isCli =
	process.argv[1] != null && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isCli) {
	process.exit(await runBootstrap());
}
