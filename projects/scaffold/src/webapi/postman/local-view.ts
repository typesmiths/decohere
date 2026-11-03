import { randomUUID } from "node:crypto";
import {
	type Auth0Env,
	openApiPathParamsToColon,
	type PostmanCollection,
	type PostmanItem,
	type PostmanRequest,
} from "./openapi-to-postman.js";

function yamlQuote(value: string): string {
	if (/[:#{}[\],&*?|<>=!%@`]/.test(value) || value.includes("\n") || value === "") {
		return JSON.stringify(value);
	}
	return value;
}

/** Local View / Native Git environment (YAML). */
export function buildEnvironmentYaml(
	name: string,
	auth: Auth0Env | undefined,
	options: { callbacks: readonly string[]; scopes: string },
): string {
	const values: Array<{ key: string; value: string }> = [
		{ key: "baseUrl", value: "http://localhost:3000" },
	];
	if (auth?.auth0Domain) {
		values.push(
			{ key: "auth0Domain", value: auth.auth0Domain },
			{ key: "auth0Audience", value: auth.auth0Audience ?? "" },
			{ key: "auth0ClientId", value: auth.auth0ClientId ?? "" },
			{
				key: "authUrl",
				value: `https://${auth.auth0Domain}/authorize?audience=${auth.auth0Audience ?? ""}`,
			},
			{
				key: "accessTokenUrl",
				value: `https://${auth.auth0Domain}/oauth/token`,
			},
			{ key: "callbackUrl", value: options.callbacks[0] },
			{ key: "scope", value: options.scopes },
		);
	}

	const lines = [`name: ${yamlQuote(name)}`, "values:"];
	for (const v of values) {
		lines.push(`  - key: ${v.key}`);
		lines.push(`    value: ${yamlQuote(v.value)}`);
		lines.push("    enabled: true");
	}
	return `${lines.join("\n")}\n`;
}

/**
 * Build Postman Local View multi-file YAML from a v2.1 collection (routes)
 * plus hand-authored Auth0 overlay.
 */
export function buildLocalViewFilesFromCollection(
	collection: PostmanCollection,
	projectName: string,
	auth: Auth0Env | undefined,
	options: { callbacks: readonly string[]; scopes: string },
): Array<{ filePath: string; content: string }> {
	const collectionDir = `postman/collections/${projectName} WebAPI`;
	const files: Array<{ filePath: string; content: string }> = [];

	const authBlock = auth?.auth0Domain
		? [
				"auth:",
				`  - id: ${randomUUID()}`,
				"    type: oauth2",
				"    name: OAuth 2.0",
				"    credentials:",
				"      addTokenTo: header",
				"      grant_type: authorization_code_with_pkce",
				`      authUrl: https://${auth.auth0Domain}/authorize?audience=${auth.auth0Audience ?? ""}`,
				`      accessTokenUrl: https://${auth.auth0Domain}/oauth/token`,
				`      clientId: ${yamlQuote(auth.auth0ClientId ?? "")}`,
				`      scope: ${yamlQuote(options.scopes)}`,
				`      redirect_uri: ${options.callbacks[0]}`,
				"      useBrowser: true",
				"      challengeAlgorithm: S256",
				"      client_authentication: body",
				'      clientSecret: ""',
				`      tokenName: ${yamlQuote(`${projectName} Access Token`)}`,
				"",
			].join("\n")
		: "";

	files.push({
		filePath: `${collectionDir}/.resources/definition.yaml`,
		content: [
			"$kind: collection",
			`name: ${yamlQuote(`${projectName} WebAPI`)}`,
			"schemaVersion: '3.0'",
			"description: >-",
			"  Open this project root in Postman Local View (Files → Open folder).",
			"  Select the Local environment, then Authorization → Get New Access Token (PKCE).",
			"  Route requests are generated from OpenAPI; Auth0 overlay is hand-authored.",
			authBlock,
		]
			.filter((l) => l !== undefined)
			.join("\n")
			.replace(/\n+$/, "\n"),
	});

	let folderOrder = 1000;
	for (const folder of collection.item ?? []) {
		if (folder.item == null) {
			continue;
		}
		const folderName = folder.name ?? "Requests";
		files.push({
			filePath: `${collectionDir}/${folderName}/.resources/definition.yaml`,
			content: [
				"$kind: folder",
				`name: ${yamlQuote(folderName)}`,
				`order: ${folderOrder}`,
				"",
			].join("\n"),
		});
		folderOrder += 1000;

		let requestOrder = 1000;
		for (const child of folder.item) {
			const yaml = requestToLocalViewYaml(child, requestOrder);
			if (yaml == null) {
				continue;
			}
			const fileName = `${sanitizeFileName(child.name ?? "Request")}.request.yaml`;
			files.push({
				filePath: `${collectionDir}/${folderName}/${fileName}`,
				content: yaml,
			});
			requestOrder += 1000;
		}
	}

	return files;
}

function requestToLocalViewYaml(item: PostmanItem, order: number): string | null {
	const request = item.request;
	if (request == null) {
		return null;
	}
	const method = (request.method ?? "GET").toUpperCase();
	const url = requestUrlForLocalView(request);
	const lines = [
		"$kind: http-request",
		`name: ${yamlQuote(item.name ?? method)}`,
		`method: ${method}`,
		`url: ${yamlQuote(url)}`,
	];

	if (request.auth?.type === "noauth") {
		lines.push("auth:", "  type: noauth");
	}

	const contentType = request.header?.find(
		(h) => h.key.toLowerCase() === "content-type",
	)?.value;
	const rawBody = request.body?.raw?.trim();
	if (rawBody) {
		lines.push("headers:");
		lines.push(`  Content-Type: ${contentType ?? "application/json"}`);
		lines.push("body:");
		lines.push("  type: json");
		lines.push("  content: |-");
		for (const bodyLine of rawBody.split("\n")) {
			lines.push(`    ${bodyLine}`);
		}
	}

	lines.push(`order: ${order}`, "");
	return lines.join("\n");
}

function requestUrlForLocalView(request: PostmanRequest): string {
	const url = request.url;
	if (typeof url === "string") {
		return openApiPathParamsToColon(url);
	}
	if (url?.raw) {
		return openApiPathParamsToColon(url.raw);
	}
	const host = url?.host?.[0] ?? "{{baseUrl}}";
	const path = (url?.path ?? [])
		.map((segment) => openApiPathParamsToColon(String(segment)))
		.join("/");
	return path ? `${host}/${path}` : host;
}

function sanitizeFileName(name: string): string {
	return name.replace(/[^\w\s()-]+/g, "").trim() || "Request";
}
