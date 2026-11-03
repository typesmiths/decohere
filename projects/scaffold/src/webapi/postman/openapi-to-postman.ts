import type { ScaffoldOpenApiDocument } from "./hello-openapi.js";

export type PostmanCollection = {
	info: {
		_postman_id?: string;
		name: string;
		schema: string;
		description?: string;
	};
	auth?: unknown;
	item?: PostmanItem[];
	variable?: Array<{ key: string; value: string }>;
	[key: string]: unknown;
};

export type PostmanItem = {
	name?: string;
	item?: PostmanItem[];
	request?: PostmanRequest;
	[key: string]: unknown;
};

export type PostmanRequest = {
	method?: string;
	header?: Array<{ key: string; value: string }>;
	body?: { mode?: string; raw?: string };
	url?: string | { raw?: string; host?: string[]; path?: string[]; variable?: unknown[] };
	auth?: { type: string; [key: string]: unknown };
	[key: string]: unknown;
};

export type Auth0Env = {
	auth0Domain?: string;
	auth0Audience?: string;
	auth0ClientId?: string;
};

type ConvertResult = {
	result: boolean;
	reason?: string;
	output?: Array<{ type: string; data: PostmanCollection }>;
};

async function convertAsync(
	data: ScaffoldOpenApiDocument,
	options: Record<string, unknown>,
): Promise<ConvertResult> {
	// Loaded here, not at the top: the converter pulls in about 700 modules (lodash, faker, ajv,
	// …), which every scaffolder run paid for even with `--postman none`.
	const { default: converter } = await import("openapi-to-postmanv2");
	return new Promise((resolve, reject) => {
		converter.convert(
			{ type: "json", data },
			options,
			(err: Error | null, result: ConvertResult) => {
				if (err) {
					reject(err);
					return;
				}
				resolve(result);
			},
		);
	});
}

/** Convert an OpenAPI document to a Postman Collection v2.1 via openapi-to-postmanv2. */
export async function openApiToPostmanCollection(
	document: ScaffoldOpenApiDocument,
): Promise<PostmanCollection> {
	const result = await convertAsync(document, {
		folderStrategy: "Tags",
		requestNameSource: "Fallback",
		includeAuthInfoInExample: false,
	});
	if (!result.result || result.output?.[0]?.data == null) {
		throw new Error(result.reason ?? "openapi-to-postmanv2 conversion failed");
	}
	return result.output[0].data;
}

/**
 * Overlay Auth0 OAuth2 (PKCE) collection auth and fix Local View-friendly URLs.
 * Route items come from OpenAPI; auth/env remain hand-authored.
 */
export function applyPostmanAuthOverlay(
	collection: PostmanCollection,
	projectName: string,
	auth: Auth0Env | undefined,
	options: {
		callbacks: readonly string[];
		scopes: string;
		description: string;
	},
): PostmanCollection {
	const next: PostmanCollection = {
		...collection,
		info: {
			...collection.info,
			name: `${projectName} WebAPI`,
			description: options.description,
			schema:
				collection.info.schema ??
				"https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
		},
	};

	if (auth?.auth0Domain) {
		next.auth = {
			type: "oauth2",
			oauth2: [
				{ key: "grant_type", value: "authorization_code_with_pkce", type: "string" },
				{
					key: "authUrl",
					value: "https://{{auth0Domain}}/authorize?audience={{auth0Audience}}",
					type: "string",
				},
				{
					key: "accessTokenUrl",
					value: "https://{{auth0Domain}}/oauth/token",
					type: "string",
				},
				{ key: "clientId", value: "{{auth0ClientId}}", type: "string" },
				{ key: "scope", value: options.scopes, type: "string" },
				{ key: "redirect_uri", value: options.callbacks[0], type: "string" },
				{ key: "useBrowser", value: "true", type: "boolean" },
				{ key: "addTokenTo", value: "header", type: "string" },
				{ key: "challengeAlgorithm", value: "S256", type: "string" },
				{ key: "client_authentication", value: "body", type: "string" },
				{ key: "clientSecret", value: "", type: "string" },
				{ key: "tokenName", value: `${projectName} Access Token`, type: "string" },
			],
		};
	}

	next.item = rewriteCollectionItems(collection.item ?? [], {
		markListAnonymous: true,
	});
	return next;
}

function rewriteCollectionItems(
	items: PostmanItem[],
	opts: { markListAnonymous: boolean },
): PostmanItem[] {
	return items.map((item) => {
		if (item.item != null) {
			return { ...item, item: rewriteCollectionItems(item.item, opts) };
		}
		const request = item.request;
		if (request == null) {
			return item;
		}
		const method = (request.method ?? "GET").toUpperCase();
		const rawUrl = requestUrlRaw(request);
		const nextRequest: PostmanRequest = {
			...request,
			url: toPostmanUrl(rawUrl),
		};
		// List Hello stays anonymous (matches scaffold AllowAnonymous on GET /hello).
		if (
			opts.markListAnonymous &&
			method === "GET" &&
			normalizePath(rawUrl) === "/hello" &&
			!rawUrl.includes("/:")
		) {
			nextRequest.auth = { type: "noauth" };
		}
		return { ...item, request: nextRequest };
	});
}

function requestUrlRaw(request: PostmanRequest): string {
	const url = request.url;
	if (typeof url === "string") {
		return url;
	}
	if (url?.raw) {
		return url.raw;
	}
	const host = url?.host?.[0] ?? "{{baseUrl}}";
	const path = (url?.path ?? []).join("/");
	return path ? `${host}/${path}` : host;
}

/** OpenAPI `{id}` → Postman `:id`, without touching `{{variables}}`. */
export function openApiPathParamsToColon(url: string): string {
	return url.replace(/(?<!\{)\{([A-Za-z_][\w]*)\}(?!\})/g, ":$1");
}

function normalizePath(rawUrl: string): string {
	const withoutBase = rawUrl.replace(/\{\{baseUrl\}\}/g, "").split("?")[0] ?? "";
	const withSlash = withoutBase.startsWith("/") ? withoutBase : `/${withoutBase}`;
	return openApiPathParamsToColon(withSlash);
}

/** Prefer Postman template URL shape used by existing Local View / API uploads. */
function toPostmanUrl(rawUrl: string): PostmanRequest["url"] {
	let pathPart = rawUrl.replace(/\{\{baseUrl\}\}/g, "");
	if (!pathPart.startsWith("/")) {
		pathPart = `/${pathPart}`;
	}
	// openapi-to-postman uses {id}; Local View / prior collections use :id
	pathPart = openApiPathParamsToColon(pathPart);
	const segments = pathPart.split("/").filter(Boolean);
	return {
		raw: `{{baseUrl}}${pathPart}`,
		host: ["{{baseUrl}}"],
		path: segments,
	};
}
