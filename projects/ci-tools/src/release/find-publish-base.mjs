#!/usr/bin/env node
/**
 * Prints the commit Publish compares a tested commit with, to see whether code changed: the last
 * one that shipped (the newest `v*` tag behind it), or its parent when nothing has shipped yet.
 * Not just the parent: the merge queue can land a code PR and a docs PR in one push, CI then runs
 * on the docs commit only, and the code under it must still publish. Prints nothing for a first
 * commit. Needs the history and the tags (`fetch-depth: 0`).
 *
 *   node find-publish-base.mjs <sha>
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

function git(args, cwd) {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}

/** Runs git, and returns undefined when it exits with `notFound`: what it uses to say it found nothing. */
function tryGit(args, cwd, notFound) {
	try {
		return git(args, cwd);
	} catch (error) {
		if (error.status === notFound) return undefined;
		throw error;
	}
}

/**
 * @param {string} sha the commit CI tested
 * @param {string} [cwd] the repository
 * @returns {string | undefined}
 */
export function findPublishBase(sha, cwd = process.cwd()) {
	const parent = tryGit(["rev-parse", "--verify", "--quiet", `${sha}^1`], cwd, 1);
	if (parent == null) return undefined;
	const tag = tryGit(
		["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", parent],
		cwd,
		128,
	);
	return tag == null ? parent : git(["rev-parse", `${tag}^{commit}`], cwd);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	const base = findPublishBase(process.argv[2]);
	if (base != null) console.log(base);
}
