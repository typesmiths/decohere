/**
 * First-publish a new package name (public) and give it its Trusted Publisher,
 * so `publish.yml` can release it over OIDC from then on.
 *
 *   pnpm npm:bootstrap [--otp <code>] [--dry-run] [--channel dev] [<package-name>...]
 *
 * Without names: every publishable package whose name is not on npm yet.
 * Run from the repo root after `npm login` to the org. Each step is skipped when
 * it is already done (the name exists, the Trusted Publisher is set).
 *
 * npm runs on this terminal, so it does its own 2FA: it asks for a code, or
 * opens the browser for web authentication. `--otp` hands it a code up front
 * through `NPM_CONFIG_OTP`; `npm trust` takes no `--otp` flag of its own.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { listPublishablePackages, npmNameExists } from "./publish-verify.mjs";

/** The Trusted Publisher every package gets: `publish.yml`'s npm job. */
export const TRUSTED_PUBLISHER = {
	repo: "typesmiths/decohere",
	file: "publish.yml",
	environment: "npm-publish",
};

/** @param {string | undefined} version */
export function needsPrereleaseTag(version) {
	return String(version ?? "").includes("-");
}

/**
 * npm arguments for a name-only first publish. Scoped names default to restricted,
 * so `--access public`. `./` stops npm reading the path as a GitHub `owner/repo`.
 *
 * @param {{ dir: string, version?: string }} pkg
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
		TRUSTED_PUBLISHER.file,
		"--repo",
		TRUSTED_PUBLISHER.repo,
		"--env",
		TRUSTED_PUBLISHER.environment,
		"--allow-publish",
		"--yes",
	];
}

/** @param {string} output `npm trust list <name> --json` */
export function hasTrustedPublisher(output) {
	return output.includes(TRUSTED_PUBLISHER.file) && output.includes(TRUSTED_PUBLISHER.repo);
}

/**
 * @typedef {{ capture?: boolean, otp?: string }} NpmOptions
 * `capture` keeps stdout to read it (npm can then not prompt for 2FA);
 * otherwise npm owns the terminal.
 */

/**
 * @param {string[]} args
 * @param {NpmOptions} [options]
 * @returns {{ status: number, output: string }}
 */
function runNpm(args, { capture = false, otp } = {}) {
	const result = spawnSync("npm", args, {
		encoding: "utf8",
		stdio: capture ? ["inherit", "pipe", "inherit"] : "inherit",
		env: otp ? { ...process.env, NPM_CONFIG_OTP: otp } : process.env,
	});
	return { status: result.status ?? 1, output: result.stdout ?? "" };
}

/**
 * @param {{
 *   argv?: string[],
 *   root?: string,
 *   io?: {
 *     npm?: (args: string[], options?: NpmOptions) => { status: number, output: string },
 *     nameExists?: (name: string) => boolean,
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
	const nameExists = io.nameExists ?? ((name) => npmNameExists(name));
	const log = io.log ?? ((line) => process.stdout.write(`${line}\n`));
	const dryRun = values["dry-run"];

	// Even on a dry run: the names are private, so `npm view` 404s without a login
	// and every package would look unpublished.
	if (npm(["whoami"]).status !== 0) {
		log("Not logged in to npm: run `npm login` first.");
		return 1;
	}

	const publishable = listPublishablePackages(options.root ?? process.cwd());
	const unknown = positionals.filter((name) => !publishable.some((pkg) => pkg.name === name));
	if (unknown.length > 0) {
		log(`Not a publishable package in projects/: ${unknown.join(", ")}`);
		return 1;
	}
	const packages =
		positionals.length > 0
			? publishable.filter((pkg) => positionals.includes(pkg.name))
			: publishable.filter((pkg) => !nameExists(pkg.name));
	if (packages.length === 0) {
		log("Every package name is on npm already. Name one to check its Trusted Publisher.");
		return 0;
	}

	// A code npm rejects (they last about 30 seconds) makes npm ask for a new one.
	/** @param {string[]} args */
	const change = (args) => {
		if (dryRun) {
			log(`[dry run] npm ${args.join(" ")}`);
			return true;
		}
		return npm(args, { otp: values.otp }).status === 0;
	};

	for (const pkg of packages) {
		log(`\n${pkg.name} (projects/${pkg.dir}, ${pkg.version})`);

		if (nameExists(pkg.name)) {
			log("  name is on npm: skip the first publish");
		} else if (!change(publishArgs(pkg, values.channel))) {
			log(`  first publish failed: stopping`);
			return 1;
		}

		const listed = dryRun
			? { status: 1, output: "" }
			: npm(["trust", "list", pkg.name, "--json"], { capture: true, otp: values.otp });
		if (listed.status === 0 && hasTrustedPublisher(listed.output)) {
			log("  Trusted Publisher is set: skip");
		} else if (!change(trustArgs(pkg.name))) {
			log("  Trusted Publisher failed: stopping");
			return 1;
		}
	}

	log(
		"\nFor each new package, also run `pnpm npm:trust-promote --otp <code>`, so Promote to latest can move its tag.",
	);
	log(
		"\nDone. Approve the waiting npm-oidc-bootstrap deployment on the Publish run, or rerun it: `gh run rerun --failed <run-id>`.",
	);
	return 0;
}

const isCli =
	process.argv[1] != null && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isCli) {
	process.exit(await runBootstrap());
}
