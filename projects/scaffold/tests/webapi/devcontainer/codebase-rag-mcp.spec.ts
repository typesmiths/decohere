import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { beforeEach, describe, expect, it } from "vitest";
import { codebaseRagMcp } from "../../../src/webapi/devcontainer/codebase-rag-mcp.js";

const HOST_MCP = JSON.stringify({
	mcpServers: {
		other: { command: "echo" },
		"codebase-rag": {
			url: "https://rag.example.com/mcp",
			headers: { Authorization: "Bearer secret-token" },
		},
	},
});

describe("codebaseRagMcp", () => {
	beforeEach(() => {
		resetMemfs();
	});
	it("reads HTTP URL and bearer token from host mcp.json", () => {
		expect(codebaseRagMcp.seedFromMcpJson(HOST_MCP)).toEqual({
			url: "https://rag.example.com/mcp",
			token: "secret-token",
		});
	});

	it("returns null when codebase-rag is missing or incomplete", () => {
		expect(codebaseRagMcp.seedFromMcpJson("{}")).toBeNull();
		expect(
			codebaseRagMcp.seedFromMcpJson(
				JSON.stringify({ mcpServers: { "codebase-rag": { url: "https://x/mcp" } } }),
			),
		).toBeNull();
	});

	it("merges codebase-rag into mcp.json without dropping other servers", () => {
		vol.fromJSON({
			"/tmp/cursor/mcp.json": JSON.stringify({ mcpServers: { keep: { url: "stdio" } } }),
		});

		const result = codebaseRagMcp.mergeIntoMcpJson({
			mcpPath: "/tmp/cursor/mcp.json",
			url: "https://rag.example.com/mcp",
			token: "secret-token",
			hostRoot: "/host/repo",
		});

		expect(result.path).toBe("/tmp/cursor/mcp.json");
		const written = JSON.parse(vol.readFileSync("/tmp/cursor/mcp.json", "utf8") as string) as {
			mcpServers: Record<string, { url?: string; headers?: Record<string, string> }>;
		};
		expect(written.mcpServers.keep).toEqual({ url: "stdio" });
		expect(written.mcpServers["codebase-rag"]).toEqual({
			url: "https://rag.example.com/mcp",
			headers: {
				Authorization: "Bearer secret-token",
				"X-Codebase-Root": "/host/repo",
			},
		});
	});

	it("seed-print writes url and token on separate lines", () => {
		vol.fromJSON({ "/tmp/host-mcp.json": HOST_MCP });
		const lines: string[] = [];
		const original = console.log;
		console.log = (msg?: unknown) => {
			lines.push(String(msg));
		};
		try {
			expect(codebaseRagMcp.main(["seed-print", "/tmp/host-mcp.json"])).toBe(0);
		} finally {
			console.log = original;
		}
		expect(lines).toEqual(["https://rag.example.com/mcp", "secret-token"]);
	});

	it("mergeFromEnv reads and writes under the workspace .cursor directory", () => {
		vol.fromJSON({
			"/repo/.cursor/codebase-rag.env":
				"CODEBASE_RAG_MCP_URL=https://rag.example.com/mcp\nCODEBASE_RAG_MCP_TOKEN=secret-token\n",
		});

		expect(
			codebaseRagMcp.mergeFromEnv({
				CODEBASE_RAG_WORKSPACE: "/repo",
			}),
		).toBe(0);

		const written = JSON.parse(
			vol.readFileSync("/repo/.cursor/mcp.json", "utf8") as string,
		) as {
			mcpServers: Record<string, { url?: string }>;
		};
		expect(written.mcpServers["codebase-rag"]?.url).toBe("https://rag.example.com/mcp");
	});
});
