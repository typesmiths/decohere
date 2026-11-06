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
