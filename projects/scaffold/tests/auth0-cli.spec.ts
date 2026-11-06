import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSpawnSync } = vi.hoisted(() => ({
	mockSpawnSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	execFileSync: vi.fn(),
	spawnSync: mockSpawnSync,
}));

const {
	assignUserPermissions,
	createAdminDatabaseUser,
	createApi,
	DB_CONNECTION_NAME,
	ensureSpaApp,
	listApiScopes,
	login,
	updateApiScopes,
} = await import("../src/webapi/features/auth0-cli.js");

beforeEach(() => {
	mockSpawnSync.mockReset();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("createApi / updateApiScopes RBAC", () => {
	it("creates APIs with --enforce-policies and access_token_authz dialect", () => {
		mockSpawnSync.mockReturnValueOnce({
			status: 0,
			stdout: JSON.stringify({ identifier: "https://api.webapi" }),
			stderr: "",
			error: undefined,
		});

		const api = createApi("webapi API", "https://api.webapi");
		expect(api.identifier).toBe("https://api.webapi");

		const args = mockSpawnSync.mock.calls[0]?.[1] as string[];
		expect(args).toEqual(
			expect.arrayContaining([
				"apis",
				"create",
				"--enforce-policies",
				"--token-dialect",
				"access_token_authz",
			]),
		);
	});

	it("updates existing APIs with --enforce-policies so re-scaffold is not fail-open", () => {
		mockSpawnSync.mockReturnValueOnce({
			status: 0,
			stdout: "",
			stderr: "",
			error: undefined,
		});

		updateApiScopes("https://api.webapi");

		const args = mockSpawnSync.mock.calls[0]?.[1] as string[];
		expect(args).toEqual(
			expect.arrayContaining([
				"apis",
				"update",
				"https://api.webapi",
				"--enforce-policies",
				"--token-dialect",
				"access_token_authz",
			]),
		);
	});
});

describe("listApiScopes / assignUserPermissions", () => {
	it("reads scope values from apis show JSON", () => {
		mockSpawnSync.mockReturnValueOnce({
			status: 0,
			stdout: JSON.stringify({
				identifier: "https://api.webapi",
				scopes: [{ value: "read:Hello" }, { value: "read:Invoice" }],
			}),
			stderr: "",
			error: undefined,
		});

		expect(listApiScopes("https://api.webapi")).toEqual(["read:Hello", "read:Invoice"]);
	});

	it("posts Authorization Core permissions for a user", () => {
		mockSpawnSync.mockReturnValueOnce({
			status: 0,
			stdout: "",
			stderr: "",
			error: undefined,
		});

		assignUserPermissions("auth0|admin", "https://api.webapi", ["read:Invoice"]);

		const args = mockSpawnSync.mock.calls[0]?.[1] as string[];
		expect(args).toEqual(
			expect.arrayContaining([
				"api",
				"post",
				`users/${encodeURIComponent("auth0|admin")}/permissions`,
			]),
		);
		const dataIdx = args.indexOf("--data");
		expect(JSON.parse(args[dataIdx + 1] ?? "{}")).toEqual({
			permissions: [
				{
					resource_server_identifier: "https://api.webapi",
					permission_name: "read:Invoice",
				},
			],
		});
	});
});

describe("listApiScopes / assignUserPermissions", () => {
	it("reads scope values from apis show JSON", () => {
		mockSpawnSync.mockReturnValueOnce({
			status: 0,
			stdout: JSON.stringify({
				identifier: "https://api.webapi",
				scopes: [{ value: "read:Hello" }, { value: "read:Invoice" }],
			}),
			stderr: "",
			error: undefined,
		});

		expect(listApiScopes("https://api.webapi")).toEqual(["read:Hello", "read:Invoice"]);
	});

	it("posts Authorization Core permissions for a user", () => {
		mockSpawnSync.mockReturnValueOnce({
			status: 0,
			stdout: "",
			stderr: "",
			error: undefined,
		});

		assignUserPermissions("auth0|admin", "https://api.webapi", ["read:Invoice"]);

		const args = mockSpawnSync.mock.calls[0]?.[1] as string[];
		expect(args).toEqual(
			expect.arrayContaining([
				"api",
				"post",
				`users/${encodeURIComponent("auth0|admin")}/permissions`,
			]),
		);
		const dataIdx = args.indexOf("--data");
		expect(JSON.parse(args[dataIdx + 1] ?? "{}")).toEqual({
			permissions: [
				{
					resource_server_identifier: "https://api.webapi",
					permission_name: "read:Invoice",
				},
			],
		});
	});
});

describe("createAdminDatabaseUser", () => {
	it("returns the created user on success", () => {
		mockSpawnSync.mockReturnValueOnce({
			status: 0,
			stdout: JSON.stringify({ user_id: "auth0|new", email: "admin@demo.example.com" }),
			stderr: "",
			error: undefined,
		});

		const admin = createAdminDatabaseUser({
			email: "admin@demo.example.com",
			password: "Secret1!",
			username: "admin",
		});

		expect(admin).toEqual({
			user_id: "auth0|new",
			email: "admin@demo.example.com",
			password: "Secret1!",
			username: "admin",
		});
		expect(mockSpawnSync).toHaveBeenCalledOnce();
	});

	it("looks up an existing user, resets password, and still returns credentials", () => {
		mockSpawnSync
			.mockReturnValueOnce({
				status: 1,
				stdout: "",
				stderr: 'The user already exists. {"statusCode":409}',
				error: undefined,
			})
			.mockReturnValueOnce({
				status: 0,
				stdout: JSON.stringify([
					{ user_id: "auth0|existing", email: "admin@demo.example.com" },
				]),
				stderr: "",
				error: undefined,
			})
			.mockReturnValueOnce({
				status: 0,
				stdout: "{}",
				stderr: "",
				error: undefined,
			});

		const admin = createAdminDatabaseUser({
			email: "admin@demo.example.com",
			password: "NewSecret1!",
			username: "admin",
		});

		expect(admin).toEqual({
			user_id: "auth0|existing",
			email: "admin@demo.example.com",
			password: "NewSecret1!",
			username: "admin",
		});

		const patchCall = mockSpawnSync.mock.calls[2]?.[1] as string[];
		expect(patchCall).toEqual(
			expect.arrayContaining([
				"api",
				"patch",
				`users/${encodeURIComponent("auth0|existing")}`,
			]),
		);
		const dataIdx = patchCall.indexOf("--data");
		expect(JSON.parse(patchCall[dataIdx + 1] ?? "{}")).toEqual({
			password: "NewSecret1!",
			connection: DB_CONNECTION_NAME,
		});
	});
});

describe("login", () => {
	it("requests scaffolder scopes with --no-input so Docker prints a device URL", () => {
		mockSpawnSync.mockReturnValueOnce({
			status: 0,
			stdout: "",
			stderr: "",
			error: undefined,
		});

		expect(login()).toBe(true);

		const args = mockSpawnSync.mock.calls[0]?.[1] as string[];
		expect(args).toEqual(["login", "--scopes", expect.any(String), "--no-input"]);
		expect(args[2]).toContain("create:clients");
		expect(args[2]).toContain("create:users");
	});
});

describe("ensureSpaApp", () => {
	it("reuses an existing app by name and refreshes callbacks", () => {
		mockSpawnSync
			.mockReturnValueOnce({
				status: 0,
				stdout: JSON.stringify([
					{ client_id: "spa_existing", name: "webapi Dev" },
					{ client_id: "other", name: "Other App" },
				]),
				stderr: "",
				error: undefined,
			})
			.mockReturnValueOnce({
				status: 0,
				stdout: "",
				stderr: "",
				error: undefined,
			});

		const app = ensureSpaApp("webapi Dev", ["http://localhost:3000", "http://localhost:3001"]);

		expect(app).toEqual({ client_id: "spa_existing", reused: true });
		const updateArgs = mockSpawnSync.mock.calls[1]?.[1] as string[];
		expect(updateArgs).toEqual(
			expect.arrayContaining([
				"apps",
				"update",
				"spa_existing",
				"--callbacks",
				"http://localhost:3000,http://localhost:3001",
				"--logout-urls",
				"http://localhost:3000,http://localhost:3001",
				"--web-origins",
				"http://localhost:3000,http://localhost:3001",
			]),
		);
	});

	it("creates a SPA when no matching app exists", () => {
		mockSpawnSync
			.mockReturnValueOnce({
				status: 0,
				stdout: JSON.stringify([{ client_id: "other", name: "Other App" }]),
				stderr: "",
				error: undefined,
			})
			.mockReturnValueOnce({
				status: 0,
				stdout: JSON.stringify({ client_id: "spa_new", name: "webapi Dev" }),
				stderr: "",
				error: undefined,
			});

		const app = ensureSpaApp("webapi Dev", ["http://localhost:3000"]);
		expect(app).toEqual({ client_id: "spa_new", reused: false });
	});

	it("fails with a delete-apps message when Auth0 hits the application entity limit", () => {
		mockSpawnSync
			.mockReturnValueOnce({
				status: 0,
				stdout: JSON.stringify([
					{ client_id: "spa_a", name: "ledger Dev" },
					{ client_id: "spa_b", name: "workspace Dev" },
					{ client_id: "m2m", name: "Default App" },
				]),
				stderr: "",
				error: undefined,
			})
			.mockReturnValueOnce({
				status: 1,
				stdout: "",
				stderr:
					"Failed to create application: 403 Forbidden: You reached the limit of entities of this type for this tenant.",
				error: undefined,
			});

		expect(() => ensureSpaApp("crypto Dev", ["http://localhost:3000"])).toThrow(
			/tenant application limit reached[\s\S]*delete unused apps/i,
		);
	});
});
