import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listExistingApiNames } from "./api-name.js";

const AUTHORIZE_RE = /@Authorize\(\s*(["'])([^"']+)\1(?:\s*,\s*(["'])([^"']+)\3)?\s*\)/g;

function isAppSource(fileName: string): boolean {
	return (
		fileName.endsWith(".ts") &&
		!fileName.endsWith(".spec.ts") &&
		!fileName.endsWith(".test.ts") &&
		!fileName.endsWith(".d.ts")
	);
}

/** Collect action:Subject scopes from Authorize decorators in each API src tree. */
export function discoverAuthorizeScopes(rootDir: string): string[] {
	const scopes = new Set<string>();
	for (const apiName of listExistingApiNames(rootDir)) {
		collectFromDir(join(rootDir, "projects", apiName, "src"), scopes);
	}
	return [...scopes].sort();
}

function collectFromDir(dir: string, scopes: Set<string>): void {
	if (!existsSync(dir)) return;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) {
			collectFromDir(path, scopes);
			continue;
		}
		if (!entry.isFile() || !isAppSource(entry.name)) continue;
		const text = readFileSync(path, "utf8");
		for (const match of text.matchAll(AUTHORIZE_RE)) {
			const action = match[2];
			if (action == null || action === "") continue;
			const subject = match[4] ?? "all";
			scopes.add(`${action}:${subject}`);
		}
	}
}

/** Additive union so Auth0 CLI scope replace does not drop permissions already on the API. */
export function mergeApiScopes(
	discovered: readonly string[],
	existing: readonly string[],
): string[] {
	return [...new Set([...existing, ...discovered])].sort();
}
