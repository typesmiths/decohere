import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { CreateCliError, isDecohereWorkspace, listExistingApiNames } from "./api-name.js";
import { discoverAuthorizeScopes, mergeApiScopes } from "./authorize-scopes.js";
import { webapiPort } from "./const.js";
import * as auth0Cli from "./features/auth0-cli.js";

export const AUTH0_CLI_INSTALL_MESSAGE =
	"The Auth0 CLI is required.\n" +
	"  It comes with the Decohere Dev Container image. If this project was created before that,\n" +
	"  update the image version in .devcontainer/Dockerfile and rebuild the Dev Container.\n" +
	"  Or install it yourself: https://github.com/auth0/auth0-cli";

/**
 * Create or reuse the app a web app's users log in through, allowing the local URL of each API,
 * and return its client id.
 */
export function ensureLoginApp(projectName: string, apiCount: number): string {
	const urls = Array.from(
		{ length: Math.max(apiCount, 1) },
		(_, index) => `http://localhost:${webapiPort(index)}`,
	);
	const app = auth0Cli.ensureSpaApp(`${projectName} Dev`, urls);
	console.log(
		app.reused
			? `  ✓ Reusing Auth0 login app (${app.client_id})`
			: `  ✓ Auth0 login app created (${app.client_id})`,
	);
	try {
		auth0Cli.enableConnectionForClient(auth0Cli.DB_CONNECTION_NAME, app.client_id);
		console.log(`  ✓ Enabled ${auth0Cli.DB_CONNECTION_NAME} on the login app`);
	} catch (err) {
		console.error(
			`  ✗ Failed to enable DB connection on the login app: ${err instanceof Error ? err.message : err}`,
		);
	}
	return app.client_id;
}

/**
 * Create or reuse the machine app `decohere auth0 token` uses, allowed exactly the API's
 * permissions, and return its client id.
 */
export function ensureTokenApp(
	projectName: string,
	audience: string,
	scopes: readonly string[],
): string {
	const app = auth0Cli.ensureM2mApp(`${projectName} Token`);
	auth0Cli.ensureClientGrant(app.client_id, audience, scopes);
	console.log(
		app.reused
			? `  ✓ Reusing Auth0 token app (${app.client_id}) with ${scopes.length} permission(s)`
			: `  ✓ Auth0 token app created (${app.client_id}) with ${scopes.length} permission(s)`,
	);
	return app.client_id;
}

function fail(message: string): never {
	throw new CreateCliError(message);
}

/** Throw if the `auth0` binary is missing. */
export function requireInstalled(): void {
	if (auth0Cli.isInstalled()) return;
	fail(AUTH0_CLI_INSTALL_MESSAGE);
}

/**
 * Log in when there is no tenant session or the Management API token is expired.
 * Returns the active tenant.
 */
export function ensureLoggedIn(): auth0Cli.Auth0Tenant {
	requireInstalled();

	process.stdout.write("\n  Checking Auth0 credentials...");
	let tenants = auth0Cli.listTenants();
	if (tenants.length === 0) {
		process.stdout.write(" not logged in.\n");
		console.log("  Logging in to Auth0 (open the URL in your browser)...");
		if (!auth0Cli.login()) fail("Auth0 login failed.");
		tenants = auth0Cli.listTenants();
	}

	try {
		auth0Cli.listApis();
		process.stdout.write(" ok.\n");
	} catch (err) {
		if (err instanceof auth0Cli.Auth0AuthError) {
			process.stdout.write(" token expired.\n");
			console.log("  Re-authenticating (open the URL in your browser)...");
			if (!auth0Cli.login()) fail("Auth0 login failed.");
			tenants = auth0Cli.listTenants();
		}
	}

	const active = tenants.find((t) => t.active) ?? tenants[0];
	if (active == null) fail("No Auth0 tenant after login.");
	return active;
}

export function runAuth0Login(): void {
	requireInstalled();
	console.log("  Logging in to Auth0 (open the URL in your browser)...");
	if (!auth0Cli.login()) fail("Auth0 login failed.");
	const tenants = auth0Cli.listTenants();
	const active = tenants.find((t) => t.active) ?? tenants[0];
	if (active == null) fail("No Auth0 tenant after login.");
	console.log(`\n  ✓ Auth0 tenant: https://${active.name}`);
	console.log("    Tokens are stored in ~/.config/auth0.");
	console.log("    Next: pnpm decohere auth0 configure");
}

export function runAuth0Configure(directory = "."): void {
	const targetDir = resolve(directory);
	if (!isDecohereWorkspace(targetDir)) {
		throw new CreateCliError(
			`Not a Decohere workspace: ${targetDir}. Scaffold one first with \`npx @decohere/create webapi\`.`,
		);
	}

	const active = ensureLoggedIn();
	const issuerBaseUrl = `https://${active.name}`;
	const projectName = process.env.DECOHERE_PROJECT_NAME?.trim() || basename(targetDir);
	const envPath = join(targetDir, ".env");
	const existing = readEnvFile(envPath);
	const existingAudience = existing.AUTH0_AUDIENCE?.trim();
	const discovered = discoverAuthorizeScopes(targetDir);
	let existingScopes: string[] = [];
	if (existingAudience) {
		try {
			existingScopes = auth0Cli.listApiScopes(existingAudience);
		} catch (err) {
			if (err instanceof auth0Cli.Auth0AuthError) throw err;
		}
	}
	const apiScopes = resolveApiScopes(discovered, existingScopes);
	console.log(
		discovered.length > 0
			? `  ✓ Scanned @Authorize — ${discovered.length} scope(s) from controllers`
			: "  ✓ No @Authorize in projects/*/src — keeping existing / Hello scopes",
	);

	let audience = existingAudience;
	if (audience) {
		try {
			auth0Cli.updateApiScopes(audience, apiScopes);
			console.log(`  ✓ API scopes ensured (${apiScopes.join(", ")})`);
		} catch (err) {
			console.error(
				`  ✗ Failed to update API scopes: ${err instanceof Error ? err.message : err}`,
			);
		}
	} else {
		const identifier = `https://api.${projectName}`;
		console.log(`\n  Creating Auth0 API ${identifier}...`);
		audience = auth0Cli.createApi(`${projectName} API`, identifier, apiScopes).identifier;
		console.log(`  ✓ API created: ${audience}`);
	}

	const clientId = ensureLoginApp(projectName, listExistingApiNames(targetDir).length);
	const tokenClientId = ensureTokenApp(projectName, audience, apiScopes);

	upsertEnv(envPath, {
		AUTH0_ISSUER_BASE_URL: issuerBaseUrl,
		AUTH0_AUDIENCE: audience,
		AUTH0_CLIENT_ID: clientId,
		AUTH0_TOKEN_CLIENT_ID: tokenClientId,
	});
	console.log(
		"  ✓ Wrote AUTH0_ISSUER_BASE_URL, AUTH0_AUDIENCE, AUTH0_CLIENT_ID and AUTH0_TOKEN_CLIENT_ID to .env",
	);

	const adminSub = existing.AUTH0_ADMIN_USER_SUB?.trim();
	if (adminSub) {
		try {
			auth0Cli.assignUserPermissions(adminSub, audience, apiScopes);
			console.log(`  ✓ Assigned ${apiScopes.length} API permission(s) to admin user`);
		} catch (err) {
			console.error(
				`  ✗ Failed to assign admin permissions: ${err instanceof Error ? err.message : err}`,
			);
		}
	}
}

/**
 * `decohere auth0 token`: print only the token, so `$(pnpm -s decohere auth0 token)` works. It's
 * printed because that's what was asked for, and it expires. Everything else goes to stderr.
 */
export function runAuth0Token(directory = "."): void {
	const targetDir = resolve(directory);
	if (!isDecohereWorkspace(targetDir)) {
		fail(`Not a Decohere workspace: ${targetDir}.`);
	}
	requireInstalled();

	const env = readEnvFile(join(targetDir, ".env"));
	const audience = env.AUTH0_AUDIENCE?.trim();
	const clientId = env.AUTH0_TOKEN_CLIENT_ID?.trim();
	if (!audience || !clientId) {
		fail("This project has no Auth0 token app yet. Run: pnpm decohere auth0 configure");
	}

	try {
		const scopes = auth0Cli.listApiScopes(audience);
		process.stdout.write(`${auth0Cli.requestAccessToken(clientId, audience, scopes)}\n`);
	} catch (err) {
		if (err instanceof auth0Cli.Auth0AuthError) {
			fail("Your Auth0 login has expired. Run: pnpm decohere auth0 login");
		}
		throw err;
	}
}

export function readEnvFile(path: string): Record<string, string> {
	if (!existsSync(path)) return {};
	const out: Record<string, string> = {};
	for (const line of readFileSync(path, "utf8").split("\n")) {
		const trimmed = line.trim();
		if (trimmed === "" || trimmed.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq <= 0) continue;
		out[line.slice(0, eq).trim()] = line.slice(eq + 1);
	}
	return out;
}

function resolveApiScopes(
	discovered: readonly string[],
	existing: readonly string[],
): string[] {
	const merged = mergeApiScopes(discovered, existing);
	return merged.length > 0 ? merged : [...auth0Cli.HELLO_API_SCOPES].sort();
}

function upsertEnv(path: string, entries: Record<string, string>): void {
	let text = existsSync(path) ? readFileSync(path, "utf8") : "";
	for (const [key, value] of Object.entries(entries)) {
		const re = new RegExp(`^${key}=.*$`, "m");
		if (re.test(text)) {
			text = text.replace(re, `${key}=${value}`);
		} else {
			text = `${text}${text === "" || text.endsWith("\n") ? "" : "\n"}${key}=${value}\n`;
		}
	}
	if (text !== "" && !text.endsWith("\n")) text = `${text}\n`;
	writeFileSync(path, text);
}
