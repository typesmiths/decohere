import {
	chmodSync,
	mkdirSync,
	readFileSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type CodebaseRagCredentials = {
	url: string;
	token: string;
};

export type McpJson = {
	mcpServers?: Record<string, unknown>;
	[key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

function loadDotenv(path: string, env: NodeJS.ProcessEnv): void {
	let raw: string;
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return;
	}
	for (const line of raw.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
		const eq = trimmed.indexOf("=");
		const key = trimmed.slice(0, eq).trim();
		const value = trimmed
			.slice(eq + 1)
			.trim()
			.replace(/^["']|["']$/g, "");
		if (key && env[key] === undefined) env[key] = value;
	}
}

function seedFromMcpJson(raw: string): CodebaseRagCredentials | null {
	let data: unknown;
	try {
		data = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!isRecord(data)) return null;
	const servers = data.mcpServers;
	if (!isRecord(servers)) return null;
	const server = servers["codebase-rag"];
	if (!isRecord(server)) return null;
	const url = typeof server.url === "string" ? server.url.trim() : "";
	const headers = isRecord(server.headers) ? server.headers : {};
	const auth = typeof headers.Authorization === "string" ? headers.Authorization.trim() : "";
	const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
	if (!url.startsWith("http") || token.length === 0) return null;
	return { url, token };
}

function mergeIntoMcpJson(input: {
	mcpPath: string;
	url: string;
	token: string;
	hostRoot: string;
}): { skipped?: string; path?: string; root?: string } {
	const { mcpPath, url, token, hostRoot } = input;
	if (!url || !token) {
		return { skipped: "no URL/token" };
	}

	const xRoot = hostRoot || "${workspaceFolder}";
	mkdirSync(dirname(mcpPath), { recursive: true });

	let data: McpJson = { mcpServers: {} };
	try {
		if (statSync(mcpPath).size > 0) {
			const loaded: unknown = JSON.parse(readFileSync(mcpPath, "utf8"));
			if (isRecord(loaded)) data = loaded as McpJson;
		}
	} catch (err) {
		const code = isRecord(err) && typeof err.code === "string" ? err.code : "";
		if (code !== "ENOENT") {
			console.log(
				"codebase-rag MCP: existing mcp.json is invalid JSON; replacing rag entry only after backup",
			);
			renameSync(mcpPath, `${mcpPath}.bak`);
		}
	}

	const servers = isRecord(data.mcpServers) ? data.mcpServers : {};
	data.mcpServers = servers;
	servers["codebase-rag"] = {
		url,
		headers: {
			Authorization: `Bearer ${token}`,
			"X-Codebase-Root": xRoot,
		},
	};
	writeFileSync(mcpPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
	try {
		chmodSync(mcpPath, 0o600);
	} catch {
		// memfs and some hosts omit chmod
	}
	return { path: mcpPath, root: xRoot };
}

function workspaceRoot(env: NodeJS.ProcessEnv = process.env): string {
	const fromEnv = env.CODEBASE_RAG_WORKSPACE?.trim();
	if (fromEnv) return fromEnv;
	// Scaffolded copy lives at <repo>/.devcontainer/codebase-rag-mcp.ts
	return dirname(dirname(fileURLToPath(import.meta.url)));
}

function mergeFromEnv(env: NodeJS.ProcessEnv = process.env): number {
	const root = workspaceRoot(env);
	const cursorDir = join(root, ".cursor");
	loadDotenv(join(cursorDir, "codebase-rag.env"), env);
	const url = (env.CODEBASE_RAG_MCP_URL ?? "").trim();
	const token = (env.CODEBASE_RAG_MCP_TOKEN ?? "").trim();
	const hostRoot = (env.CODEBASE_RAG_MCP_ROOT ?? "").trim() || root;
	const result = mergeIntoMcpJson({
		mcpPath: join(cursorDir, "mcp.json"),
		url,
		token,
		hostRoot,
	});
	if (result.skipped != null) {
		console.log(`codebase-rag MCP: skipped (${result.skipped})`);
		return 0;
	}
	console.log(`codebase-rag MCP: wrote ${result.path} url=${url} root=${result.root}`);
	return 0;
}

function seedPrint(mcpPath: string): number {
	let raw: string;
	try {
		raw = readFileSync(mcpPath, "utf8");
	} catch {
		return 1;
	}
	const creds = seedFromMcpJson(raw);
	if (creds == null) return 1;
	console.log(creds.url);
	console.log(creds.token);
	return 0;
}

function main(argv = process.argv.slice(2)): number {
	const command = argv[0] ?? "merge";
	if (command === "seed-print") {
		const mcpPath = argv[1];
		if (mcpPath == null || mcpPath.length === 0) return 1;
		return seedPrint(mcpPath);
	}
	if (command === "merge") {
		return mergeFromEnv();
	}
	console.error(`codebase-rag MCP: unknown command ${command}`);
	return 1;
}

const invoked = (process.argv[1] ?? "").replaceAll("\\", "/");
if (invoked.endsWith("/codebase-rag-mcp.ts") || invoked.endsWith("/codebase-rag-mcp.js")) {
	process.exit(main());
}

export const codebaseRagMcp = {
	loadDotenv,
	seedFromMcpJson,
	mergeIntoMcpJson,
	mergeFromEnv,
	seedPrint,
	main,
};
