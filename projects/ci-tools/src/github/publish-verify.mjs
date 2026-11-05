import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { listProjectDirs } from "../lib/workspace-packages.mjs";

/**
 * Workspace packages that `forge publish` will upload (not `"private": true`), including
 * grouped ones such as `projects/data/data-typeorm`.
 * @param {string} root
 */
export function listPublishablePackages(root) {
	const packages = [];
	for (const projectDir of listProjectDirs(root)) {
		const pkg = JSON.parse(readFileSync(join(projectDir, "package.json"), "utf8"));
		if (typeof pkg.name !== "string" || pkg.private === true) {
			continue;
		}
		packages.push({
			name: pkg.name,
			version: pkg.version,
			dir: relative(join(root, "projects"), projectDir),
		});
	}
	return packages.sort((a, b) => a.name.localeCompare(b.name));
}

export function dockerRepositories(root) {
	const create = JSON.parse(readFileSync(join(root, "projects/create/package.json"), "utf8"));
	const devcontainer = JSON.parse(
		readFileSync(join(root, "projects/devcontainer/package.json"), "utf8"),
	);
	return {
		create: create.decohere?.dockerImageRepository ?? "ghcr.io/typesmiths/decohere/create",
		devcontainer:
			devcontainer.decohere?.dockerImageRepository ??
			"ghcr.io/typesmiths/decohere/devcontainer",
		createVersion: create.version,
		workspaceVersion: JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version,
	};
}

/**
 * @param {string} spec package or package@version
 * @param {{ spawnSync?: typeof spawnSync }} [io]
 */
export function npmNameExists(spec, io = {}) {
	const spawn = io.spawnSync ?? spawnSync;
	const result = spawn("npm", ["view", spec, "name"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	return result.status === 0;
}

/**
 * @param {string} spec package@version
 * @param {{ spawnSync?: typeof spawnSync }} [io]
 */
export function npmVersionExists(spec, io = {}) {
	const spawn = io.spawnSync ?? spawnSync;
	const result = spawn("npm", ["view", spec, "version"], {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	});
	return result.status === 0;
}

/**
 * Parse `ghcr.io/org/name/image` into GitHub packages API coordinates.
 * @param {string} repository
 */
export function parseGhcrRepository(repository) {
	const withoutHost = repository.replace(/^ghcr\.io\//, "");
	const slash = withoutHost.indexOf("/");
	if (slash < 0) {
		throw new Error(`Not a GHCR repository: ${repository}`);
	}
	return {
		org: withoutHost.slice(0, slash),
		packageName: withoutHost.slice(slash + 1),
	};
}

/**
 * @param {string} repository ghcr.io/org/pkg
 * @param {string} tag
 * @param {{ token: string, fetch?: typeof fetch }} io
 */
export async function ghcrTagExists(repository, tag, io) {
	const { org, packageName } = parseGhcrRepository(repository);
	const encoded = encodeURIComponent(packageName);
	const headers = {
		Authorization: `Bearer ${io.token}`,
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	};
	const fetchImpl = io.fetch ?? fetch;
	for (let page = 1; page <= 20; page += 1) {
		const url = `https://api.github.com/orgs/${org}/packages/container/${encoded}/versions?per_page=100&page=${page}`;
		const response = await fetchImpl(url, { headers });
		if (response.status === 404) {
			return false;
		}
		if (!response.ok) {
			throw new Error(`GHCR versions ${response.status} for ${repository}`);
		}
		const versions = await response.json();
		if (!Array.isArray(versions) || versions.length === 0) {
			return false;
		}
		for (const version of versions) {
			const tags = version.metadata?.container?.tags ?? [];
			if (tags.includes(tag)) {
				return true;
			}
		}
		if (versions.length < 100) {
			return false;
		}
	}
	return false;
}

/**
 * @param {{
 *   root: string,
 *   spawnSync?: typeof spawnSync,
 *   fetch?: typeof fetch,
 *   githubToken?: string,
 * }} options
 */
export async function collectPublishVerify(options) {
	const packages = listPublishablePackages(options.root);
	const unpublished = [];
	let publishedVersions = 0;
	for (const pkg of packages) {
		if (!npmNameExists(pkg.name, options)) {
			unpublished.push(pkg.name);
			continue;
		}
		if (npmVersionExists(`${pkg.name}@${pkg.version}`, options)) {
			publishedVersions += 1;
		}
	}

	const images = dockerRepositories(options.root);
	const token = options.githubToken ?? "";
	let skipDocker = false;
	if (token) {
		const createExists = await ghcrTagExists(images.create, images.workspaceVersion, {
			token,
			fetch: options.fetch,
		});
		const devExists = await ghcrTagExists(images.devcontainer, images.workspaceVersion, {
			token,
			fetch: options.fetch,
		});
		skipDocker = createExists && devExists;
	}

	return {
		unpublished,
		skipNpm: packages.length > 0 && publishedVersions === packages.length,
		skipDocker,
		imageTag: images.workspaceVersion,
		createVersion: images.createVersion,
		repository: images.create,
		devcontainerRepository: images.devcontainer,
		packageCount: packages.length,
		publishedVersions,
	};
}

export function formatGithubOutput(result) {
	return [
		`unpublished=${result.unpublished.join(" ")}`,
		`skip_npm=${result.skipNpm ? "true" : "false"}`,
		`skip_docker=${result.skipDocker ? "true" : "false"}`,
		`image_tag=${result.imageTag}`,
		`create_version=${result.createVersion}`,
		`repository=${result.repository}`,
		`devcontainer_repository=${result.devcontainerRepository}`,
	].join("\n");
}

const isCli =
	process.argv[1] != null && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isCli) {
	const result = await collectPublishVerify({
		root: process.cwd(),
		githubToken: process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN,
	});
	const body = formatGithubOutput(result);
	process.stdout.write(`${body}\n`);
	if (process.env.GITHUB_OUTPUT) {
		const { appendFileSync } = await import("node:fs");
		appendFileSync(process.env.GITHUB_OUTPUT, `${body}\n`);
	}
	if (result.unpublished.length) {
		process.stderr.write(`Not on npm yet: ${result.unpublished.join(", ")}\n`);
	}
}
