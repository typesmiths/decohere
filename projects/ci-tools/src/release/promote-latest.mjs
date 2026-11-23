#!/usr/bin/env node
/**
 * Points npm's `latest` tag at a version on every public @decohere package. Run by
 * `promote-latest.yml`, which authenticates over OIDC.
 *
 * With no version, takes what `dev` points at. Refuses a version that isn't on every package, has
 * no `v*` tag on origin (a version only gets one once it passed CI and fully shipped), or is under
 * a day old, unless `allowYoung` is set: current pnpm skips versions that new and would install an
 * older one. Safe to re-run: packages already there are skipped.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { listPublishablePackages } from "../github/publish-verify.mjs";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const LAUNCH_PACKAGE = "@decohere/cli";

/** @typedef {{ status: number | null, stdout: string }} RunResult */

/**
 * @param {{
 *   version?: string,
 *   allowYoung?: boolean,
 *   packages: string[],
 *   run: (command: string, args: string[]) => RunResult,
 *   now?: () => number,
 *   log?: (message: string) => void,
 * }} options
 * @returns {number} exit code
 */
export function promoteLatest(options) {
	const { packages, run, allowYoung = false } = options;
	const now = options.now ?? Date.now;
	const log = options.log ?? console.log;
	const npm = (...args) => run("npm", args);

	/** `npm dist-tag ls` reads fresh; `npm view` can lag for a minute or more after a move. */
	const distTag = (name, tag) =>
		new RegExp(`^${tag}: (.+)$`, "m").exec(npm("dist-tag", "ls", name).stdout)?.[1]?.trim();

	const version = options.version?.trim() || distTag(LAUNCH_PACKAGE, "dev");
	if (!version) {
		log(`Could not read the dev tag of ${LAUNCH_PACKAGE}. Nothing moved.`);
		return 1;
	}
	log(`Promoting ${version} to latest on ${packages.length} packages`);

	// Once a stable version is out, latest belongs to releases: see "Stable release" in docs/contributing/ci.
	const current = distTag(LAUNCH_PACKAGE, "latest");
	if (current != null && !current.includes("-") && version.includes("-")) {
		log(`latest is the stable ${current}, and ${version} is a dev version. Nothing moved.`);
		return 1;
	}

	// Asks origin: the workflow's checkout is shallow and holds only the tip commit's tags.
	const ref = `refs/tags/v${version}`;
	const remote = run("git", ["ls-remote", "--tags", "origin", ref]);
	if (remote.status !== 0) {
		log("Could not read the tags on origin. Nothing moved.");
		return 1;
	}
	if (!remote.stdout.split("\n").some((line) => line.split("\t")[1] === ref)) {
		log(`${version} has no v${version} tag, so it didn't fully ship. Nothing moved.`);
		return 1;
	}

	const missing = packages.filter(
		(name) => npm("view", `${name}@${version}`, "version").stdout.trim() !== version,
	);
	if (missing.length > 0) {
		log(`Not on npm at ${version}: ${missing.join(", ")}. Nothing moved.`);
		return 1;
	}

	if (!allowYoung) {
		const published = Date.parse(
			npm("view", `${LAUNCH_PACKAGE}@${version}`, "time", "--json").stdout.match(
				new RegExp(`"${version.replaceAll(".", "\\.")}":\\s*"([^"]+)"`),
			)?.[1] ?? "",
		);
		if (Number.isNaN(published)) {
			log(`Could not read when ${version} was published. Nothing moved.`);
			return 1;
		}
		const hours = (now() - published) / (60 * 60 * 1000);
		if (now() - published < ONE_DAY_MS) {
			log(
				`${version} is ${hours.toFixed(1)} hours old. Current pnpm skips versions under a day old ` +
					"and would install an older one. Wait, or run with allow_young. Nothing moved.",
			);
			return 1;
		}
	}

	const onLatest = (name) => distTag(name, "latest") === version;

	const failed = [];
	for (const name of packages) {
		if (onLatest(name)) {
			log(`already there: ${name}`);
			continue;
		}
		if (npm("dist-tag", "add", `${name}@${version}`, "latest").status !== 0) {
			failed.push(name);
		}
	}

	const wrong = packages.filter((name) => !failed.includes(name) && !onLatest(name));
	if (failed.length > 0 || wrong.length > 0) {
		log(`Failed to move: ${[...failed, ...wrong].join(", ")}. Run it again to finish.`);
		return 1;
	}
	log(`latest is now ${version} on all ${packages.length} packages`);
	return 0;
}

if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const packages = listPublishablePackages(resolve(".")).map((pkg) => pkg.name);
	process.exit(
		promoteLatest({
			version: process.env.PROMOTE_VERSION,
			allowYoung: process.env.PROMOTE_ALLOW_YOUNG === "true",
			packages,
			run: (command, args) => {
				const result = spawnSync(command, args, {
					encoding: "utf8",
					stdio: ["ignore", "pipe", "inherit"],
				});
				return { status: result.status, stdout: result.stdout ?? "" };
			},
		}),
	);
}
