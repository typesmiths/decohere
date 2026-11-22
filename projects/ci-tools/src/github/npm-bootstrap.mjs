/**
 * Sets up npm so CI can publish and promote every package: the name exists, `publish.yml` is a
 * Trusted Publisher (to publish), and `promote-latest.yml` is one (to move `latest`, with only the
 * dist-tag permission). Run it after adding a package, or any time: each step is skipped when it is
 * already done, so with nothing to do it changes nothing.
 *
 *   npm login
 *   pnpm npm:bootstrap --otp <code> [--dry-run] [<package-name>...]
 *
 * Without names: every publishable package in this checkout. A named package needn't be in it, so a
 * new package's PR can be set up from `main`; one that isn't on npm yet must be in a package.json on
 * some branch of the repo, so a typo can't claim a name. Everything is read first, in parallel, and
 * then only the missing steps run, so one OTP code (about 30 seconds) can cover them. npm wants the
 * code even to read a package's Trusted Publishers, so it is required, also for `--dry-run`.
 *
 * The first publish only claims the name: a stub with a package.json and a README, version
 * `0.0.0-bootstrap.0`, so nothing from the checkout is shipped. CI publishes the package built.
 * It and the `publish.yml` publisher go through npm's CLI. The `promote-latest.yml`
 * publisher is copied from a package that has it, through the registry endpoint `npm trust` uses,
 * because `npm trust` has no flag for the dist-tag permission (`manageDistTags`). npm doesn't
 * document that endpoint. The calls use the npm login in the user's npmrc, which is never printed.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

/** The stub's version: below any version CI publishes, and a prerelease, so it needs a tag. */
export const STUB_VERSION = "0.0.0-bootstrap.0";

/**
 * npm arguments for the first publish, of the stub in `dir`. Scoped names default to restricted,
 * so `--access public`; a prerelease needs a tag other than `latest`.
 *
 * @param {string} dir an absolute path, so npm doesn't read it as a GitHub `owner/repo`
 */
export function publishArgs(dir) {
	return ["publish", dir, "--access", "public", "--tag", "bootstrap"];
}

/**
 * Write the stub that claims a name: a package.json and a README, in a new temporary folder.
 *
 * @param {string} name
 * @returns {string} the folder
 */
export function writeStub(name) {
	const dir = join(tmpdir(), `npm-bootstrap-${randomUUID()}`);
	mkdirSync(dir, { recursive: true });
	const manifest = {
		name,
		version: STUB_VERSION,
		description: `Reserves ${name}. Its releases are published from CI.`,
		license: "ISC",
		repository: { type: "git", url: `git+https://github.com/${REPOSITORY}.git` },
	};
	writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
	writeFileSync(
		join(dir, "README.md"),
		`# ${name}\n\nThis version only reserves the name. Install a release: see https://github.com/${REPOSITORY}.\n`,
	);
	return dir;
}

/**
 * Whether a package of this name is in a package.json under projects/ on any branch of the repo,
 * after fetching them.
 *
 * @param {string} name
 * @param {string} root
 */
async function isOnBranch(name, root) {
	const git = (/** @type {string[]} */ args) =>
		spawnSync("git", args, { cwd: root, encoding: "utf8" });
	const fetched = git(["fetch", "--quiet", "origin"]);
	if (fetched.status !== 0) throw new Error(`git fetch origin failed: ${fetched.stderr}`);
	const refs = git(["for-each-ref", "--format=%(refname)", "refs/remotes/origin"])
		.stdout.split("\n")
		.filter((ref) => ref !== "" && !ref.endsWith("/HEAD"));
	const found = git([
		"grep",
		"--fixed-strings",
		"--files-with-matches",
		`"name": "${name}"`,
		...refs,
		"--",
		"projects/**/package.json",
	]);
	return found.status === 0;
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
 *     isOnBranch?: (name: string) => Promise<boolean>,
 *     writeStub?: (name: string) => string,
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

	const root = options.root ?? process.cwd();
	const inCheckout = listPublishablePackages(root);
	// Named packages this checkout doesn't have, such as a new one whose PR isn't merged.
	/** @type {Package[]} */
	const elsewhere = positionals
		.filter((name) => !inCheckout.some((pkg) => pkg.name === name))
		.map((name) => ({ name, dir: "" }));
	const publishable = [...inCheckout, ...elsewhere];
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
		// A name to claim must be a package somewhere in the repo, so a typo can't take one.
		const checkBranch = io.isOnBranch ?? ((name) => isOnBranch(name, root));
		const unknown = [];
		for (const { pkg, exists } of state) {
			if (elsewhere.includes(pkg) && !exists && !(await checkBranch(pkg.name))) {
				unknown.push(pkg.name);
			}
		}
		if (unknown.length > 0) {
			log(
				`Not a package on any branch of ${REPOSITORY}: ${unknown.join(", ")}. Nothing changed.`,
			);
			return 1;
		}
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
		log(
			pkg.dir ? `\n${pkg.name} (projects/${pkg.dir})` : `\n${pkg.name} (not in this checkout)`,
		);

		if (!plan.publish) {
			log("  name is on npm: skip the first publish");
		} else if (!runChange(publishArgs((io.writeStub ?? writeStub)(pkg.name)))) {
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
