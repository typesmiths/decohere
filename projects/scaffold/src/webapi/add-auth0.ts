import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { listExistingApiNames } from "./api-name.js";
import { runAuth0Configure } from "./auth0-commands.js";
import { AUTH_CONFIG_SECTION } from "./models/auth-config.model.js";

const AUTH_IMPORT = 'import "@decohere/http/auth";';
const CONFIGURATION_CALL = /^([ \t]*)\.withConfiguration\([^\n]*\)[ \t]*$/m;
const IMPORT_STATEMENT = /^import\b[^;]*;[ \t]*$/gm;

/**
 * Add auth to the text of a main.ts, or return undefined if it can't be done safely. Only
 * handles the shape the scaffolder generates, because this file belongs to the user.
 */
export function addAuthToMain(source: string): string | undefined {
	if (source.includes(".withAuth(")) return source;
	const call = CONFIGURATION_CALL.exec(source);
	if (call == null) return undefined;

	const withCall = source.replace(
		CONFIGURATION_CALL,
		(line, indent: string) => `${line}\n${indent}.withAuth()`,
	);
	if (withCall.includes(AUTH_IMPORT)) return withCall;

	const lastImport = [...withCall.matchAll(IMPORT_STATEMENT)].at(-1);
	if (lastImport == null) return `${AUTH_IMPORT}\n${withCall}`;
	const end = lastImport.index + lastImport[0].length;
	return `${withCall.slice(0, end)}\n${AUTH_IMPORT}${withCall.slice(end)}`;
}

function addAuthToConfig(targetDir: string): void {
	const path = join(targetDir, "config/config.yaml");
	if (!existsSync(path)) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, AUTH_CONFIG_SECTION);
		return;
	}
	const text = readFileSync(path, "utf8");
	if (/^auth:/m.test(text)) return;
	const separator = text === "" || text.endsWith("\n") ? "" : "\n";
	writeFileSync(path, `${text}${separator}${AUTH_CONFIG_SECTION}`);
}

/** Wire auth into each API. Returns the main.ts files the user has to change by hand. */
export function addAuthToWorkspace(targetDir: string): string[] {
	addAuthToConfig(targetDir);

	const byHand: string[] = [];
	for (const apiName of listExistingApiNames(targetDir)) {
		const relativePath = join("projects", apiName, "src/main.ts");
		const path = join(targetDir, relativePath);
		const patched = existsSync(path) ? addAuthToMain(readFileSync(path, "utf8")) : undefined;
		if (patched == null) {
			byHand.push(relativePath);
			continue;
		}
		writeFileSync(path, patched);
	}
	return byHand;
}

/** `decohere add auth0`. Sets up Auth0 first, so a failed login leaves the source untouched. */
export function runAddAuth0(directory = "."): void {
	const targetDir = resolve(directory);
	runAuth0Configure(directory);
	const byHand = addAuthToWorkspace(targetDir);

	if (byHand.length > 0) {
		console.log("\n  These files don't have the shape this command can change safely:");
		for (const path of byHand) console.log(`    ${path}`);
		console.log(`\n  Add this to each one:\n\n    ${AUTH_IMPORT}`);
		console.log("\n  and call .withAuth() on the builder, before .build().");
	}
	console.log(
		'\n  ✓ Auth0 added. Protect a route with @Authorize("read", "Invoice"), then run:',
	);
	console.log("\n    decohere auth0 configure\n");
}
