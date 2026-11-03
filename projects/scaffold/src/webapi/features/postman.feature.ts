import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pick } from "../../domain/prompt.js";
import { WELL_KNOWN_FILES } from "../../models/const.js";
import type { WorkspaceScaffold } from "../../models/project.model.js";
import type { Feature } from "../../services/scaffold.service.js";
import type { AuthConfigModel } from "../models/auth-config.model.js";
import { buildHelloOpenApiDocument } from "../postman/hello-openapi.js";
import {
	buildEnvironmentYaml,
	buildLocalViewFilesFromCollection,
} from "../postman/local-view.js";
import {
	type Auth0Env,
	applyPostmanAuthOverlay,
	openApiToPostmanCollection,
} from "../postman/openapi-to-postman.js";
import * as auth0Cli from "./auth0-cli.js";

/** Postman OAuth callback URLs (popup + "Authorize using browser"). */
const POSTMAN_CALLBACKS = [
	"https://oauth.pstmn.io/v1/callback",
	"https://oauth.pstmn.io/v1/browser-callback",
] as const;

/** Scopes requested for Auth0 access tokens (OIDC + Hello CASL permissions). */
const POSTMAN_SCOPES = [
	"openid",
	"profile",
	"email",
	"read:Hello",
	"create:Hello",
	"update:Hello",
	"delete:Hello",
].join(" ");

const COLLECTION_DESCRIPTION =
	"Open the project root in Postman Local View (not the postman/ folder). " +
	"Select the Local environment, then Authorization → Get New Access Token (PKCE). " +
	"Routes are generated from OpenAPI; Auth0 overlay is hand-authored.";

export type PostmanOptions = {
	postmanProvider?: "api" | "local" | "none";
	apiKey?: string;
	workspaceId?: string;
};

async function getOptions(
	_workspace: WorkspaceScaffold,
	cliOptions: Partial<PostmanOptions>,
): Promise<Partial<PostmanOptions>> {
	if (cliOptions.postmanProvider != null) return {};

	const choices = [
		{ label: "none" as const, description: "skip" },
		{
			label: "local" as const,
			description: "Local View / Native Git files (no API key)",
		},
		{
			label: "api" as const,
			description: "also upload to Postman.com (needs API key)",
		},
	];
	const selected = await pick(
		"\n  Postman: ",
		choices,
		(c) => `${c.label} — ${c.description}`,
	);
	const provider = selected?.label ?? "none";

	if (provider === "none") return { postmanProvider: "none" };
	if (provider === "local") return { postmanProvider: "local" };

	const apiKey =
		process.env.POSTMAN_API_KEY ??
		(await import("../../domain/prompt.js").then((m) =>
			m.ask("\n  Postman API key (app.getpostman.com/settings/me/api-keys): "),
		));

	const headers = { "X-Api-Key": apiKey, "Content-Type": "application/json" };
	const wsRes = await fetch("https://api.getpostman.com/workspaces", { headers });

	if (!wsRes.ok) {
		console.error("\n  Postman API key invalid — falling back to local files.");
		return { postmanProvider: "local" };
	}

	const { workspaces } = (await wsRes.json()) as {
		workspaces: Array<{ id: string; name: string; type: string }>;
	};

	type WsChoice = { label: string; id: string | null };
	const wsChoices: WsChoice[] = [
		{ label: "<new workspace>", id: null },
		...workspaces.map((w) => ({ label: `${w.name} (${w.type})`, id: w.id })),
	];

	const wsPicked = await pick("\n  Postman workspace: ", wsChoices, (c) => c.label);

	let workspaceId: string;
	if (!wsPicked || wsPicked.id === null) {
		const { ask } = await import("../../domain/prompt.js");
		const wsName = await ask(`  Workspace name: `);
		const createRes = await fetch("https://api.getpostman.com/workspaces", {
			method: "POST",
			headers,
			body: JSON.stringify({ workspace: { name: wsName, type: "personal" } }),
		});
		const { workspace: ws } = (await createRes.json()) as { workspace: { id: string } };
		workspaceId = ws.id;
		console.log(`  ✓ Workspace created: ${wsName}`);
	} else {
		workspaceId = wsPicked.id;
	}

	return { postmanProvider: "api", apiKey, workspaceId };
}

/** Build Postman collection: OpenAPI routes + Auth0 auth overlay. */
export async function buildHybridPostmanCollection(projectName: string, auth?: Auth0Env) {
	const openapi = buildHelloOpenApiDocument(projectName);
	const base = await openApiToPostmanCollection(openapi);
	if (base.info._postman_id == null) {
		base.info._postman_id = randomUUID();
	}
	return applyPostmanAuthOverlay(base, projectName, auth, {
		callbacks: POSTMAN_CALLBACKS,
		scopes: POSTMAN_SCOPES,
		description: COLLECTION_DESCRIPTION,
	});
}

/** Read a previously scaffolded auth0ClientId so re-scaffold never blanks it. */
function readExistingSpaClientId(targetDir: string, projectName: string): string | undefined {
	const envPath = join(
		targetDir,
		"postman/environments",
		`${projectName}-Local.environment.yaml`,
	);
	if (!existsSync(envPath)) return undefined;
	const text = readFileSync(envPath, "utf8");
	const match = text.match(/key:\s*auth0ClientId\s*\n\s*value:\s*["']?([^"'\n]+)/);
	const value = match?.[1]?.trim();
	return value && value.length > 0 ? value : undefined;
}

/**
 * Resolve the Postman SPA client id. Never returns empty — preserves an existing
 * env value on Auth0 failure, otherwise throws so we do not write a blank env.
 */
function resolveSpaClientId(workspace: WorkspaceScaffold): string {
	const appName = `${workspace.name} Postman`;
	try {
		const app = auth0Cli.ensureSpaApp(appName, [...POSTMAN_CALLBACKS]);
		console.log(
			app.reused
				? `  ✓ Reusing Auth0 SPA app for Postman PKCE (${app.client_id})`
				: `  ✓ Auth0 SPA app created for Postman PKCE (${app.client_id})`,
		);
		try {
			auth0Cli.enableConnectionForClient(auth0Cli.DB_CONNECTION_NAME, app.client_id);
			console.log(`  ✓ Enabled ${auth0Cli.DB_CONNECTION_NAME} on Postman SPA`);
		} catch (err) {
			console.error(
				`  ✗ Failed to enable DB connection on SPA: ${err instanceof Error ? err.message : err}`,
			);
		}
		return app.client_id;
	} catch (err) {
		const existing = readExistingSpaClientId(workspace.targetDir, workspace.name);
		if (existing) {
			console.error(
				`  ✗ Failed to ensure Auth0 SPA app (${err instanceof Error ? err.message : err})`,
			);
			console.log(`  ✓ Keeping existing auth0ClientId from Postman environment (${existing})`);
			return existing;
		}
		const detail = err instanceof Error ? err.message : String(err);
		// Entity-limit messages are already actionable; avoid burying them.
		if (auth0Cli.isAuth0EntityLimitError(err)) {
			throw new Error(detail);
		}
		throw new Error(
			`Failed to ensure Auth0 SPA app for Postman — auth0ClientId would be empty: ${detail}`,
		);
	}
}

async function scaffold(workspace: WorkspaceScaffold, options: PostmanOptions): Promise<void> {
	if (options.postmanProvider === "none" || options.postmanProvider == null) return;

	const authConfigModel = workspace.getModel<AuthConfigModel>(WELL_KNOWN_FILES.AUTH_CONFIG);
	const authCfg = authConfigModel?.config;

	const spaClientId = authCfg?.issuerBaseUrl ? resolveSpaClientId(workspace) : undefined;

	const auth0Env: Auth0Env | undefined = authCfg?.issuerBaseUrl
		? {
				auth0Domain: authCfg.issuerBaseUrl.replace(/^https?:\/\//, ""),
				auth0Audience: authCfg.audience,
				auth0ClientId: spaClientId,
			}
		: undefined;

	const projectName = workspace.name;
	const envName = `${projectName} Local`;
	const collection = await buildHybridPostmanCollection(projectName, auth0Env);
	const localFiles = buildLocalViewFilesFromCollection(collection, projectName, auth0Env, {
		callbacks: POSTMAN_CALLBACKS,
		scopes: POSTMAN_SCOPES,
	});
	const envYaml = buildEnvironmentYaml(envName, auth0Env, {
		callbacks: POSTMAN_CALLBACKS,
		scopes: POSTMAN_SCOPES,
	});

	workspace.addFile({
		files: () => [
			{
				filePath: ".postman/resources.yaml",
				content: [
					"# Open this project root in Postman (Files → Open folder), not the postman/ subfolder.",
					"# Postman fills workspace.id when you connect Local View.",
					"#",
					"# All resources under postman/ are registered automatically.",
					"# Route requests are generated from OpenAPI; Auth0 overlay is hand-authored.",
					"",
				].join("\n"),
			},
			{
				filePath: `postman/environments/${projectName}-Local.environment.yaml`,
				content: envYaml,
			},
			...localFiles,
		],
	});

	if (options.postmanProvider === "api" && options.apiKey) {
		const headers = { "X-Api-Key": options.apiKey, "Content-Type": "application/json" };

		const colRes = await fetch(
			`https://api.getpostman.com/collections?workspace=${options.workspaceId}`,
			{
				method: "POST",
				headers,
				body: JSON.stringify({ collection }),
			},
		);
		if (colRes.ok) {
			console.log("  ✓ Postman collection uploaded");
		} else {
			console.error("  ✗ Failed to upload Postman collection");
		}

		const envValues = [
			{ key: "baseUrl", value: "http://localhost:3000", enabled: true },
			...(auth0Env?.auth0Domain
				? [
						{ key: "auth0Domain", value: auth0Env.auth0Domain, enabled: true },
						{ key: "auth0Audience", value: auth0Env.auth0Audience ?? "", enabled: true },
						{ key: "auth0ClientId", value: auth0Env.auth0ClientId ?? "", enabled: true },
					]
				: []),
		];
		const envRes = await fetch(
			`https://api.getpostman.com/environments?workspace=${options.workspaceId}`,
			{
				method: "POST",
				headers,
				body: JSON.stringify({
					environment: { name: envName, values: envValues },
				}),
			},
		);
		if (envRes.ok) {
			console.log("  ✓ Postman environment uploaded");
		} else {
			console.error("  ✗ Failed to upload Postman environment");
		}
	}
}

export const PostmanFeature: Feature<PostmanOptions> = { getOptions, scaffold };
export { buildHelloOpenApiDocument } from "../postman/hello-openapi.js";
export { POSTMAN_CALLBACKS, POSTMAN_SCOPES };
