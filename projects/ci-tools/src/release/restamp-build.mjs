#!/usr/bin/env node
/**
 * Gives a tested build its stable version by changing only `package.json` files, so what ships is
 * the code that was tested. Refuses if the old version appears anywhere else, because then the
 * version couldn't be changed in those files alone. Checks everything before writing anything.
 *
 *   node restamp-build.mjs <build dir> <tested version> <stable version>
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const STABLE = /^\d+\.\d+\.\d+$/;
const DEPENDENCY_KEYS = [
	"dependencies",
	"devDependencies",
	"peerDependencies",
	"optionalDependencies",
];

function listFiles(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const path = join(dir, entry.name);
		return entry.isDirectory() ? listFiles(path) : [path];
	});
}

/**
 * @param {{ dir: string, from: string, to: string }} options
 * @returns {{ packages: string[] }}
 */
export function restampBuild({ dir, from, to }) {
	if (!STABLE.test(to)) {
		throw new Error(`${to} isn't a stable version: expected major.minor.patch`);
	}

	const files = listFiles(dir);
	const stamped = [];
	const elsewhere = [];
	for (const file of files) {
		const text = readFileSync(file, "utf8");
		if (file.endsWith("/package.json")) {
			const manifest = JSON.parse(text);
			if (manifest.version !== from) {
				throw new Error(`${manifest.name} is at ${manifest.version}, not ${from}`);
			}
			manifest.version = to;
			for (const key of DEPENDENCY_KEYS) {
				for (const name of Object.keys(manifest[key] ?? {})) {
					if (name.startsWith("@decohere/") && manifest[key][name] === from) {
						manifest[key][name] = to;
					}
				}
			}
			const output = `${JSON.stringify(manifest, null, 2)}\n`;
			if (output.includes(from)) elsewhere.push(relative(dir, file));
			stamped.push({ file, name: manifest.name, output });
		} else if (text.includes(from)) {
			elsewhere.push(relative(dir, file));
		}
	}

	if (stamped.length === 0) {
		throw new Error(`No packages in ${dir}`);
	}
	if (elsewhere.length > 0) {
		throw new Error(`${from} also appears in: ${elsewhere.join(", ")}`);
	}

	for (const { file, output } of stamped) {
		writeFileSync(file, output);
	}
	return { packages: stamped.map((item) => item.name).sort() };
}

if (
	process.argv[1] != null &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	const [dir, from, to] = process.argv.slice(2);
	if (!dir || !from || !to) {
		console.error("Usage: restamp-build.mjs <build dir> <tested version> <stable version>");
		process.exit(1);
	}
	const { packages } = restampBuild({ dir, from, to });
	console.log(`${packages.length} packages now at ${to}`);
}
