import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ask, pick } from "../domain/prompt.js";
import { basename, join, resolve } from "node:path";
import { CreateCliError, isDecohereWorkspace, listExistingApiNames } from "./api-name.js";
import { discoverAuthorizeScopes, mergeApiScopes } from "./authorize-scopes.js";
import { webapiPort } from "./const.js";
import * as auth0Cli from "./auth0-cli.js";

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

/** Which Auth0 API a project uses, as chosen when it was created. */
export type Auth0ApiChoice = { audience: string; create: boolean };

/**
 * The questions `decohere create` asks about Auth0: logs in, then picks an API or names a new
 * one. Changes nothing on Auth0.
 */
export async function askAuth0Api(projectName: string): Promise<Auth0ApiChoice> {
	const active = ensureLoggedIn();
	console.log(`\n  ✓ Auth0 tenant: https://${active.name}`);
	process.stdout.write("\n  Fetching Auth0 APIs...");
	const userApis = auth0Cli.listApis().filter((a) => !a.name.includes("Management API"));
	process.stdout.write(` found ${userApis.length}.\n`);
	const fresh = `https://api.${projectName}`;
	const choices = [
		{ label: `<new> ${fresh}`, existing: null },
		...userApis.map((a) => ({ label: `${a.name} — ${a.identifier}`, existing: a.identifier })),
	];
	const selected = await pick("\n  Select Auth0 API: ", choices, (c) => c.label);
	if (selected?.existing == null) {
		return { audience: await ask(`  API Identifier [${fresh}]: `, fresh), create: true };
	}
	console.log(`  ✓ Selected: ${selected.existing}`);
	return { audience: selected.existing, create: false };
}

/**
 * Sets up a project on Auth0: its API with the permissions its controllers' @Authorize name, the
 * app its users log in through, and the machine app `decohere auth0 token` uses. Returns the
 * values for `.env`; the caller writes them. Without a choice, it keeps the project's API, or
 * creates https://api.<project>.
 */
export function configureTenant(
	targetDir: string,
	projectName: string,
	appCount: number,
	choice?: Auth0ApiChoice,
): Record<string, string> {
	const active = ensureLoggedIn();
	const issuerBaseUrl = `https://${active.name}`;
	const existing = readEnvFile(join(targetDir, ".env"));
	const projectIssuer = existing.AUTH0_ISSUER_BASE_URL?.trim();
	if (projectIssuer && projectIssuer !== issuerBaseUrl) {
		fail(
			`This project is set up for Auth0 tenant ${projectIssuer},\n` +
				`  but you're logged in to ${issuerBaseUrl}.\n` +
				"  Log in to the right tenant with: pnpm decohere auth0 login",
		);
	}
	const known =
		choice?.create === true
			? undefined
			: (choice?.audience ?? existing.AUTH0_AUDIENCE?.trim());
	const discovered = discoverAuthorizeScopes(targetDir);
	let existingScopes: string[] = [];
	if (known) {
		try {
			existingScopes = auth0Cli.listApiScopes(known);
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

	let audience = known;
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
		const identifier = choice?.audience ?? `https://api.${projectName}`;
		console.log(`\n  Creating Auth0 API ${identifier}...`);
		audience = auth0Cli.createApi(`${projectName} API`, identifier, apiScopes).identifier;
		console.log(`  ✓ API created: ${audience}`);
	}

	const env: Record<string, string> = {
		AUTH0_ISSUER_BASE_URL: issuerBaseUrl,
		AUTH0_AUDIENCE: audience,
		AUTH0_CLIENT_ID: resolveLoginClientId(projectName, appCount, existing),
		AUTH0_TOKEN_CLIENT_ID: ensureTokenApp(projectName, audience, apiScopes),
	};

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
	return env;
}

/**
 * The login app's client id. If Auth0 fails, keeps the id from an earlier run. Otherwise it
 * fails, so a project is never left with no way to get a token.
 */
function resolveLoginClientId(
	projectName: string,
	appCount: number,
	existing: Record<string, string>,
): string {
	try {
		return ensureLoginApp(projectName, appCount);
	} catch (err) {
		const detail = err instanceof Error ? err.message : String(err);
		const kept = existing.AUTH0_CLIENT_ID?.trim();
		if (kept) {
			console.error(`  ✗ Failed to ensure the Auth0 login app (${detail})`);
			console.log(`  ✓ Keeping AUTH0_CLIENT_ID from .env (${kept})`);
			return kept;
		}
		// Application-limit messages already say what to do.
		if (auth0Cli.isAuth0EntityLimitError(err)) throw new Error(detail);
		throw new Error(`Failed to create the Auth0 login app: ${detail}`);
	}
}

/** `decohere auth0 configure`: brings the project's Auth0 API up to its @Authorize permissions. */
export function runAuth0Configure(directory = "."): void {
	const targetDir = resolve(directory);
	if (!isDecohereWorkspace(targetDir)) {
		throw new CreateCliError(
			`Not a Decohere workspace: ${targetDir}. Scaffold one first with \`npx @decohere/create webapi\`.`,
		);
	}
	const projectName = process.env.DECOHERE_PROJECT_NAME?.trim() || basename(targetDir);
	const env = configureTenant(targetDir, projectName, listExistingApiNames(targetDir).length);
	upsertEnv(join(targetDir, ".env"), env);
	console.log(
		"  ✓ Wrote AUTH0_ISSUER_BASE_URL, AUTH0_AUDIENCE, AUTH0_CLIENT_ID and AUTH0_TOKEN_CLIENT_ID to .env",
	);
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

	const requestToken = () => {
		const scopes = auth0Cli.listApiScopes(audience);
		return auth0Cli.requestAccessToken(clientId, audience, scopes);
	};

	let token: string;
	try {
		token = requestToken();
	} catch (err) {
		if (!(err instanceof auth0Cli.Auth0AuthError)) throw err;
		// A new Dev Container starts logged out. Only the token may go to stdout.
		console.error("  Logging in to Auth0 (open the URL in your browser)...");
		if (!auth0Cli.login()) fail("Auth0 login failed.");
		token = requestToken();
	}
	process.stdout.write(`${token}\n`);
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

export function upsertEnv(path: string, entries: Record<string, string>): void {
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

/** An admin's email: the username if it is one, else one on the project's example.com domain. */
function adminEmail(projectName: string, username: string): string {
	if (username.includes("@")) return username;
	const slug = projectName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
	return `${username}@${slug}.example.com`;
}

/**
 * Creates (or resets) the project's admin user on Auth0, and returns the values for `.env`. The
 * password comes from the launcher, which saves it after a successful run; it is never written
 * here. Without one, no admin user is created.
 */
export function createAdminUser(
	projectName: string,
	username: string,
	password: string | undefined,
): Record<string, string> {
	if (!password) {
		console.log("  No admin password was provided, so no Auth0 admin user was created.");
		return {};
	}
	const email = adminEmail(projectName, username);
	try {
		const admin = auth0Cli.createAdminDatabaseUser({ email, password, username });
		console.log(`  ✓ Auth0 admin user ready: ${admin.email} (role: admin)`);
		console.log(`    Login with EMAIL (not username): ${admin.email}`);
		return {
			AUTH0_ADMIN_USER_SUB: admin.user_id,
			AUTH0_ADMIN_USER_EMAIL: admin.email,
			AUTH0_ADMIN_USERNAME: admin.username,
		};
	} catch (err) {
		console.error(
			`  ✗ Failed to ensure Auth0 admin user (${email}): ${err instanceof Error ? err.message : err}`,
		);
		return {};
	}
}
