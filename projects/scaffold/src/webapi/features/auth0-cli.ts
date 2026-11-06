import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";

/** Management API scopes needed for API, SPA, connections, and admin users. */
const REQUIRED_SCOPES = [
	"create:clients",
	"read:clients",
	"update:clients",
	"create:resource_servers",
	"read:resource_servers",
	"update:resource_servers",
	"read:connections",
	"update:connections",
	"create:users",
	"read:users",
	"update:users",
	"create:client_grants",
	"read:client_grants",
	"update:client_grants",
	"read:client_keys",
].join(",");

/** Hard timeout for any Management API call. Prevents indefinite hangs on token re-auth. */
const API_TIMEOUT_MS = 8_000;

/** Default API scopes matching Hello CASL Authorize decorators. */
export const HELLO_API_SCOPES = [
	"read:Hello",
	"create:Hello",
	"update:Hello",
	"delete:Hello",
] as const;

export const DB_CONNECTION_NAME = "Username-Password-Authentication";

export class Auth0AuthError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = "Auth0AuthError";
	}
}

/** Returns true if an error or stderr output looks like an expired/missing token. */
function isAuthError(text: string): boolean {
	return (
		text.includes("renew access token") ||
		text.includes("log in") ||
		text.includes("Unauthorized")
	);
}

/** Strip Auth0 CLI banner lines before JSON. */
function parseJsonOutput<T>(stdout: string): T {
	const start = stdout.indexOf("{");
	const arrayStart = stdout.indexOf("[");
	let idx = -1;
	if (start === -1) idx = arrayStart;
	else if (arrayStart === -1) idx = start;
	else idx = Math.min(start, arrayStart);
	if (idx < 0) throw new Error(`Expected JSON from auth0 CLI, got: ${stdout.slice(0, 200)}`);
	return JSON.parse(stdout.slice(idx)) as T;
}

/** Run an auth0 CLI command with a hard timeout. Returns stdout on success, throws on failure. */
function runAuth0(args: string[]): string {
	const result = spawnSync("auth0", args, {
		encoding: "utf8",
		timeout: API_TIMEOUT_MS,
		input: "",
		stdio: "pipe",
	});

	if (result.error) {
		const msg = result.error.message;
		if (isAuthError(msg) || (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
			throw new Auth0AuthError(msg);
		}
		throw result.error;
	}

	if (result.status !== 0) {
		const stderr = result.stderr ?? "";
		if (isAuthError(stderr)) throw new Auth0AuthError(stderr);
		throw new Error(stderr || `auth0 exited with code ${result.status}`);
	}

	return result.stdout;
}

export interface Auth0Tenant {
	name: string;
	active?: boolean;
}

export function isInstalled(): boolean {
	try {
		execFileSync("auth0", ["--version"], { stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

export function listTenants(): Auth0Tenant[] {
	try {
		const out = execFileSync("auth0", ["tenants", "list", "--json"], {
			encoding: "utf8",
			stdio: "pipe",
		});
		return JSON.parse(out) as Auth0Tenant[];
	} catch {
		return [];
	}
}

/** Device/URL login (`--no-input`) so Docker can print a host-browser URL. */
export function login(): boolean {
	const result = spawnSync("auth0", ["login", "--scopes", REQUIRED_SCOPES, "--no-input"], {
		stdio: "inherit",
	});
	return result.status === 0;
}

export function listApis(): Array<{ identifier: string; name: string }> {
	try {
		const out = runAuth0(["apis", "list", "--json", "--no-input"]);
		return parseJsonOutput(out);
	} catch (err) {
		if (err instanceof Auth0AuthError) throw err;
		return [];
	}
}

export function createApi(
	name: string,
	identifier: string,
	scopes: readonly string[] = HELLO_API_SCOPES,
): { identifier: string } {
	const out = runAuth0([
		"apis",
		"create",
		"--name",
		name,
		"--identifier",
		identifier,
		"--scopes",
		scopes.join(","),
		// RBAC: only permissions assigned to the user/role appear on the token.
		"--enforce-policies",
		// Include Auth0 `permissions[]` claim (consumed by sample principalMapper).
		"--token-dialect",
		"access_token_authz",
		"--json",
		"--no-input",
	]);
	return parseJsonOutput(out);
}

export function listApiScopes(identifier: string): string[] {
	try {
		const out = runAuth0(["apis", "show", identifier, "--json", "--no-input"]);
		const api = parseJsonOutput<{
			scopes?: Array<string | { value?: string; name?: string }>;
		}>(out);
		return (api.scopes ?? [])
			.map((scope) => (typeof scope === "string" ? scope : (scope.value ?? scope.name ?? "")))
			.filter((scope) => scope.length > 0);
	} catch (err) {
		if (err instanceof Auth0AuthError) throw err;
		return [];
	}
}

/** Assign API permissions to a user (Authorization Core). Idempotent when already granted. */
export function assignUserPermissions(
	userId: string,
	audience: string,
	permissions: readonly string[],
): void {
	if (permissions.length === 0) return;
	runAuth0([
		"api",
		"post",
		`users/${encodeURIComponent(userId)}/permissions`,
		"--data",
		JSON.stringify({
			permissions: permissions.map((permission_name) => ({
				resource_server_identifier: audience,
				permission_name,
			})),
		}),
		"--no-input",
	]);
}

/**
 * Replace an API's scopes and enable RBAC policy enforcement.
 * Auth0 CLI `--scopes` replaces the full set.
 */
export function updateApiScopes(
	identifier: string,
	scopes: readonly string[] = HELLO_API_SCOPES,
): void {
	runAuth0([
		"apis",
		"update",
		identifier,
		"--scopes",
		scopes.join(","),
		"--enforce-policies",
		"--token-dialect",
		"access_token_authz",
		"--no-input",
	]);
}

/** True when Auth0 refuses create because the tenant hit its Applications quota. */
export function isAuth0EntityLimitError(err: unknown): boolean {
	const text = err instanceof Error ? err.message : String(err);
	return /limit of entities|reached the limit|tenant application limit reached/i.test(text);
}

/**
 * Actionable message when Auth0 will not create another application.
 * Does not suggest reusing unrelated apps — free tenants must delete unused ones.
 */
export function formatSpaEntityLimitError(appName: string, apps: Auth0App[]): string {
	const listed =
		apps.length === 0
			? "Could not list existing applications."
			: `This tenant already has ${apps.length} application(s):\n${apps
					.map((a) => `  - ${a.name} (${a.client_id})`)
					.join("\n")}`;

	return [
		`Auth0 refused to create SPA "${appName}": tenant application limit reached.`,
		listed,
		"",
		"Fix: Auth0 Dashboard → Applications → Applications → delete unused apps,",
		"then run the command again.",
		"Running it again for the same project reuses an app with the same name if it still exists.",
	].join("\n");
}

/** Where a local web app may send people to log in, and come back to. */
function spaUrlFlags(urls: readonly string[]): string[] {
	const list = urls.join(",");
	return [
		"--callbacks",
		list,
		"--logout-urls",
		list,
		"--origins",
		list,
		"--web-origins",
		list,
	];
}

export function createSpaApp(name: string, urls: readonly string[]): { client_id: string } {
	const out = runAuth0([
		"apps",
		"create",
		"--name",
		name,
		"--type",
		"spa",
		...spaUrlFlags(urls),
		"--json",
		"--no-input",
	]);
	const app = parseJsonOutput<{ client_id?: string; clientId?: string }>(out);
	const clientId = app.client_id ?? app.clientId;
	if (!clientId) {
		throw new Error(
			`Auth0 create SPA response missing client_id. stdout: ${out.slice(0, 300)}`,
		);
	}
	return { client_id: clientId };
}

export type Auth0App = { client_id: string; name: string };

/** Create or reuse a machine app, which can get a token with no browser and no user. */
export function ensureM2mApp(name: string): { client_id: string; reused: boolean } {
	const existing = listApps().find((app) => app.name === name);
	if (existing != null) return { client_id: existing.client_id, reused: true };

	const out = runAuth0([
		"apps",
		"create",
		"--name",
		name,
		"--type",
		"m2m",
		"--json",
		"--no-input",
	]);
	const app = parseJsonOutput<{ client_id?: string; clientId?: string }>(out);
	const clientId = app.client_id ?? app.clientId;
	if (!clientId) throw new Error("Auth0's response to creating the app had no client_id.");
	return { client_id: clientId, reused: false };
}

/** Let a machine app ask the API for exactly these permissions. */
export function ensureClientGrant(
	clientId: string,
	audience: string,
	scopes: readonly string[],
): void {
	const query = new URLSearchParams({ client_id: clientId, audience }).toString();
	const found = parseJsonOutput<Array<{ id: string }>>(
		runAuth0(["api", "get", `client-grants?${query}`, "--no-input"]),
	);
	const [grant] = found;
	if (grant != null) {
		runAuth0([
			"api",
			"patch",
			`client-grants/${encodeURIComponent(grant.id)}`,
			"--data",
			JSON.stringify({ scope: scopes }),
			"--no-input",
		]);
		return;
	}
	runAuth0([
		"api",
		"post",
		"client-grants",
		"--data",
		JSON.stringify({ client_id: clientId, audience, scope: scopes }),
		"--no-input",
	]);
}

/** A token for a machine app. Errors never include the CLI's output, which holds the token. */
export function requestAccessToken(
	clientId: string,
	audience: string,
	scopes: readonly string[],
): string {
	const out = runAuth0([
		"test",
		"token",
		clientId,
		"--audience",
		audience,
		"--scopes",
		scopes.join(","),
		"--force",
		"--json",
		"--no-input",
	]);
	let token: unknown;
	try {
		token = JSON.parse(out.slice(out.indexOf("{"))).access_token;
	} catch {
		throw new Error("The Auth0 CLI's token response wasn't valid JSON.");
	}
	if (typeof token !== "string" || token === "") {
		throw new Error("The Auth0 CLI's token response had no access_token.");
	}
	return token;
}

export function listApps(): Auth0App[] {
	try {
		const out = runAuth0(["apps", "list", "--json", "--no-input"]);
		const apps =
			parseJsonOutput<Array<{ client_id?: string; clientId?: string; name?: string }>>(out);
		return apps
			.map((a) => ({
				client_id: a.client_id ?? a.clientId ?? "",
				name: a.name ?? "",
			}))
			.filter((a) => a.client_id && a.name);
	} catch (err) {
		if (err instanceof Auth0AuthError) throw err;
		return [];
	}
}

export function updateSpaUrls(clientId: string, urls: readonly string[]): void {
	runAuth0(["apps", "update", clientId, ...spaUrlFlags(urls), "--no-input"]);
}

/**
 * Create a single-page app a web app's users log in through, or reuse one with the same name,
 * and allow these URLs on it.
 * On Auth0 application-quota errors, throws a clear delete-apps message (no cross-app reuse).
 */
export function ensureSpaApp(
	name: string,
	urls: readonly string[],
): { client_id: string; reused: boolean } {
	const apps = listApps();
	const existing = apps.find((a) => a.name === name);
	if (existing) {
		updateSpaUrls(existing.client_id, urls);
		return { client_id: existing.client_id, reused: true };
	}
	try {
		return { ...createSpaApp(name, urls), reused: false };
	} catch (err) {
		if (isAuth0EntityLimitError(err)) {
			throw new Error(formatSpaEntityLimitError(name, apps));
		}
		throw err;
	}
}

type Auth0Connection = { id: string; name: string; strategy: string };

/** Enable a database connection for an application (required for username/password login). */
export function enableConnectionForClient(connectionName: string, clientId: string): void {
	const listOut = runAuth0(["api", "get", "connections", "--no-input"]);
	const connections = parseJsonOutput<Auth0Connection[]>(listOut);
	const connection = connections.find((c) => c.name === connectionName);
	if (!connection) {
		throw new Error(`Auth0 connection not found: ${connectionName}`);
	}

	const clientsOut = runAuth0([
		"api",
		"get",
		`connections/${connection.id}/clients`,
		"--no-input",
	]);
	const { clients } = parseJsonOutput<{ clients: Array<{ client_id: string }> }>(clientsOut);
	if (clients.some((c) => c.client_id === clientId)) return;

	// Dedicated enabled-clients endpoint (enabled_clients on connection PATCH is deprecated).
	runAuth0([
		"api",
		"patch",
		`connections/${connection.id}/clients`,
		"--data",
		JSON.stringify([{ client_id: clientId, status: true }]),
		"--no-input",
	]);
}

export type AdminDatabaseUser = {
	user_id: string;
	email: string;
	password: string;
	username: string;
};

/** Strong default password when the scaffolder caller leaves password blank. */
export function generateAdminPassword(): string {
	return `${randomBytes(12).toString("base64url")}aA1!`;
}

function isUserAlreadyExistsError(err: unknown): boolean {
	const text = err instanceof Error ? err.message : String(err);
	return /already exists|user exists|Conflict|409/i.test(text);
}

/** Look up a user by email (Management API users-by-email). */
export function findUserByEmail(email: string): { user_id: string; email: string } | null {
	const out = runAuth0([
		"api",
		"get",
		`users-by-email?email=${encodeURIComponent(email)}`,
		"--no-input",
	]);
	const users = parseJsonOutput<Array<{ user_id?: string; email?: string }>>(out);
	const user = users.find((u) => u.user_id && u.email);
	if (!user?.user_id || !user.email) return null;
	return { user_id: user.user_id, email: user.email };
}

/** Reset password so a re-scaffold can write a known password to .env. */
export function updateUserPassword(userId: string, password: string): void {
	runAuth0([
		"api",
		"patch",
		`users/${encodeURIComponent(userId)}`,
		"--data",
		JSON.stringify({ password, connection: DB_CONNECTION_NAME }),
		"--no-input",
	]);
}

/**
 * Create a DB connection root-admin user for local login.
 * If the user already exists, look them up, reset password to `input.password`,
 * and return that identity so callers can still write .env credentials.
 */
export function createAdminDatabaseUser(input: {
	email: string;
	password: string;
	username: string;
}): AdminDatabaseUser {
	const body = {
		email: input.email,
		connection: DB_CONNECTION_NAME,
		password: input.password,
		name: input.username,
		email_verified: true,
		verify_email: false,
		app_metadata: { roles: ["admin"] },
	};

	try {
		const out = runAuth0([
			"api",
			"post",
			"users",
			"--data",
			JSON.stringify(body),
			"--no-input",
		]);
		const user = parseJsonOutput<{ user_id?: string; email?: string }>(out);
		if (!user.user_id || !user.email) {
			throw new Error(
				`Auth0 create user response missing user_id/email. stdout: ${out.slice(0, 300)}`,
			);
		}
		return {
			user_id: user.user_id,
			email: user.email,
			password: input.password,
			username: input.username,
		};
	} catch (err) {
		if (!isUserAlreadyExistsError(err)) throw err;

		const existing = findUserByEmail(input.email);
		if (!existing) {
			throw new Error(
				`Auth0 user already exists for ${input.email}, but lookup by email returned no user.`,
			);
		}

		updateUserPassword(existing.user_id, input.password);
		return {
			user_id: existing.user_id,
			email: existing.email,
			password: input.password,
			username: input.username,
		};
	}
}

export { REQUIRED_SCOPES };
