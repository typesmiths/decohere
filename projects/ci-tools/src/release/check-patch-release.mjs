#!/usr/bin/env node
/**
 * Checks a patch release before it starts: the branch is a `release/<major>.<minor>` branch, the
 * version belongs on it, and it's newer than npm `latest`. A patch of an older line would take
 * `latest` backwards, and there's no separate dist-tag for those yet.
 *
 *   node check-patch-release.mjs <branch> <version> <npm latest>
 */
import { pathToFileURL } from "node:url";

const BRANCH = /^release\/(\d+)\.(\d+)$/;
const VERSION = /^(\d+)\.(\d+)\.(\d+)/;

/** A dev version such as 0.0.1-dev.1 sorts below 0.0.1. */
function isOlderOrSame(version, than) {
	const parts = (text) => VERSION.exec(text)?.slice(1).map(Number) ?? [0, 0, 0];
	const [a, b] = [parts(version), parts(than)];
	for (const index of [0, 1, 2]) {
		if (a[index] !== b[index]) return a[index] < b[index];
	}
	return !version.includes("-") && !than.includes("-");
}

/** @param {{ branch: string, version: string, latest: string }} options */
export function checkPatchRelease({ branch, version, latest }) {
	const line = BRANCH.exec(branch);
	if (line == null) {
		throw new Error(`${branch} isn't a patch branch: expected release/<major>.<minor>`);
	}
	const parts = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
	if (parts == null || parts[1] !== line[1] || parts[2] !== line[2]) {
		throw new Error(`${version} isn't on ${branch}`);
	}
	if (Number(parts[3]) === 0) {
		throw new Error(`${version} isn't a patch: its last number is 0`);
	}
	if (isOlderOrSame(version, latest)) {
		throw new Error(`${version} isn't newer: it's older than latest (${latest}), or the same`);
	}
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [branch, version, latest] = process.argv.slice(2);
	try {
		checkPatchRelease({ branch, version, latest });
	} catch (error) {
		console.error(`::error::${error.message}`);
		process.exit(1);
	}
}
