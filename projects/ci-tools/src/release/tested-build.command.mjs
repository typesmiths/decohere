#!/usr/bin/env node
/**
 * Prints the id of the CI run whose release build ships a commit (see tested-build.service.mjs).
 * Exits 1 with a reason when there's none: Publish ships only what CI tested, never a new build.
 *
 *   GH_TOKEN=… GITHUB_REPOSITORY=owner/repo node tested-build.command.mjs <sha> <event>[,<event>…]
 */
import { pathToFileURL } from "node:url";
import { TestedBuildError } from "./tested-build.error.mjs";
import { TestedBuild } from "./tested-build.service.mjs";

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	const [sha, events] = process.argv.slice(2);
	const repo = process.env.GITHUB_REPOSITORY;
	const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
	const base = process.env.GITHUB_API_URL ?? "https://api.github.com";
	if (!sha || !events || !repo || !token) {
		console.error(
			"Usage: GH_TOKEN=… GITHUB_REPOSITORY=owner/repo tested-build.command.mjs <sha> <event>[,<event>…]",
		);
		process.exit(1);
	}

	const api = async (path) => {
		const response = await fetch(`${base}/${path}`, {
			headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
		});
		if (!response.ok) throw new Error(`GitHub answered ${response.status} to GET ${path}`);
		return response.json();
	};

	try {
		const found = await new TestedBuild({ repo, api }).find(sha, events.split(","));
		console.error(`Tested by ${found.url} (${found.event})`);
		console.log(found.runId);
	} catch (error) {
		if (!(error instanceof TestedBuildError)) throw error;
		console.error(`::error::${error.message}`);
		process.exit(1);
	}
}
