import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { CreateCliError, isDecohereWorkspace } from "./api-name.js";
import {
	discoverAuthorizeScopes,
	mergeApiScopes,
	postmanRequestedScopes,
} from "./authorize-scopes.js";
import * as auth0Cli from "./features/auth0-cli.js";

/** Same Postman OAuth callbacks as `PostmanFeature`. */
const POSTMAN_CALLBACKS = [
	"https://oauth.pstmn.io/v1/callback",
	"https://oauth.pstmn.io/v1/browser-callback",
] as const;

const SPA_SUFFIX = " Postman";

export const AUTH0_CLI_INSTALL_MESSAGE =
	"The Auth0 CLI is required.\n" +
	"  It is bundled in the Decohere create image (`npx @decohere/create auth0 login`).\n" +
	"  Host install: brew install auth0/auth0-cli/auth0\n" +
	"  Or visit: https://github.com/auth0/auth0-cli";

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
	console.log("    Tokens are stored in ~/.config/auth0 (mounted into the create image).");
	console.log("    Next: npx @decohere/create auth0 configure");
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

	const appName = `${projectName}${SPA_SUFFIX}`;
	const app = auth0Cli.ensureSpaApp(appName, [...POSTMAN_CALLBACKS]);
	console.log(
		app.reused
			? `  ✓ Reusing Auth0 SPA app (${app.client_id})`
			: `  ✓ Auth0 SPA app created (${app.client_id})`,
	);
	try {
		auth0Cli.enableConnectionForClient(auth0Cli.DB_CONNECTION_NAME, app.client_id);
		console.log(`  ✓ Enabled ${auth0Cli.DB_CONNECTION_NAME} on SPA`);
	} catch (err) {
		console.error(
			`  ✗ Failed to enable DB connection on SPA: ${err instanceof Error ? err.message : err}`,
		);
	}

	upsertEnv(envPath, {
		AUTH0_ISSUER_BASE_URL: issuerBaseUrl,
		AUTH0_AUDIENCE: audience,
	});
	console.log(`  ✓ Wrote AUTH0_ISSUER_BASE_URL and AUTH0_AUDIENCE to .env`);

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

	const domain = issuerBaseUrl.replace(/^https?:\/\//, "");
	patchPostmanAuth(targetDir, projectName, {
		domain,
		audience,
		clientId: app.client_id,
		scopes: postmanRequestedScopes(apiScopes),
	});
}

function readEnvFile(path: string): Record<string, string> {
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

function patchPostmanAuth(
	targetDir: string,
	projectName: string,
	auth: { domain: string; audience: string; clientId: string; scopes: string },
): void {
	const envYaml = join(
		targetDir,
		"postman/environments",
		`${projectName}-Local.environment.yaml`,
	);
	if (existsSync(envYaml)) {
		let yaml = readFileSync(envYaml, "utf8");
		yaml = replaceYamlKeyedValue(yaml, "auth0Domain", auth.domain);
		yaml = replaceYamlKeyedValue(yaml, "auth0Audience", auth.audience);
		yaml = replaceYamlKeyedValue(yaml, "auth0ClientId", auth.clientId);
		yaml = replaceYamlKeyedValue(
			yaml,
			"authUrl",
			`https://${auth.domain}/authorize?audience=${auth.audience}`,
		);
		yaml = replaceYamlKeyedValue(yaml, "accessTokenUrl", `https://${auth.domain}/oauth/token`);
		yaml = replaceYamlKeyedValue(yaml, "scope", auth.scopes);
		writeFileSync(envYaml, yaml);
		console.log(`  ✓ Updated Postman environment auth0ClientId (${auth.clientId})`);
		console.log(`  ✓ Updated Postman token scopes`);
	}

	const collectionDef = join(
		targetDir,
		"postman/collections",
		`${projectName} WebAPI`,
		".resources/definition.yaml",
	);
	if (existsSync(collectionDef)) {
		let yaml = readFileSync(collectionDef, "utf8");
		yaml = yaml.replace(/^(\s*clientId:\s*).+$/m, `$1${JSON.stringify(auth.clientId)}`);
		yaml = yaml.replace(/^(\s*scope:\s*).+$/m, `$1${JSON.stringify(auth.scopes)}`);
		writeFileSync(collectionDef, yaml);
	}
}

/** Replace `key: <name>` / `value: …` pairs in Postman Local View environment YAML. */
function replaceYamlKeyedValue(yaml: string, key: string, value: string): string {
	const quoted = JSON.stringify(value);
	const re = new RegExp(`(key:\\s*${key}\\s*\\n\\s*value:\\s*)[^\\n]+`, "m");
	if (!re.test(yaml)) return yaml;
	return yaml.replace(re, `$1${quoted}`);
}
