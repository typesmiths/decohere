import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetMemfs } from "@decohere/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedDevcontainerTemplates } from "./seed-devcontainer-templates.js";

/**
 * Feature-level coverage for Auth0 wiring.
 *
 * webapi.spec.ts only asserts install behaviour with authProvider:"none" and
 * stubs auth0-cli as isInstalled:false — so a missing .env never failed the suite.
 */

const {
	mockAsk,
	mockPick,
	mockInstall,
	mockCreateAdminDatabaseUser,
	mockEnsureSpaApp,
	mockEnableConnectionForClient,
	mockIsInstalled,
	mockEnsureM2mApp,
	mockEnsureClientGrant,
} = vi.hoisted(() => ({
	mockAsk: vi.fn((_q: string, fallback = "") => Promise.resolve(fallback)),
	mockPick: vi.fn(
		<T>(_label: string, items: T[], _display: (item: T) => string): Promise<T | null> =>
			Promise.resolve(items[0] ?? null),
	),
	mockInstall: vi.fn().mockResolvedValue({ message: "", data: [] }),
	mockCreateAdminDatabaseUser: vi.fn(),
	mockEnsureSpaApp: vi.fn(),
	mockEnableConnectionForClient: vi.fn(),
	mockIsInstalled: vi.fn(() => true),
	mockEnsureM2mApp: vi.fn(() => ({ client_id: "m2m_1", reused: false })),
	mockEnsureClientGrant: vi.fn(),
}));

const mockPm = {
	name: "pnpm" as const,
	install: mockInstall,
	syncLockFile: vi.fn().mockResolvedValue({ message: "", data: [] }),
};

vi.mock("../src/domain/prompt.js", async () => {
	const actual = await import("../src/domain/prompt.js");
	return { ...actual, ask: mockAsk, pick: mockPick };
});

vi.mock(import("../../devkit/src/interop/index.js"), async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		detectPackageManager: () => mockPm,
		promptForPackageManager: () => Promise.resolve(mockPm),
	};
});

vi.mock(import("../src/webapi/features/auth0-cli.js"), async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		isInstalled: mockIsInstalled,
		ensureM2mApp: mockEnsureM2mApp,
		ensureClientGrant: mockEnsureClientGrant,
		login: () => true,
		listTenants: () => [{ name: "dev-tenant.us.auth0.com", active: true }],
		listApis: () => [{ name: "webapi API", identifier: "https://api.webapi" }],
		updateApiScopes: vi.fn(),
		createAdminDatabaseUser: mockCreateAdminDatabaseUser,
		ensureSpaApp: mockEnsureSpaApp,
		enableConnectionForClient: mockEnableConnectionForClient,
	};
});

vi.mock("../src/webapi/features/format-files.js", () => ({
	formatScaffoldedFiles: vi.fn(),
}));

const { scaffoldApi } = await import("../src/webapi/create-api.js");

const TARGET = "/my-api";

/** Extra Auth0 fields accepted via the shared options bag (AuthFeature). */
type ScaffoldOpts = Parameters<typeof scaffoldApi>[0] & {
	issuerBaseUrl?: string;
	audience?: string;
	adminUsername?: string;
	adminPassword?: string;
};

function read(rel: string): string {
	return readFileSync(join(TARGET, rel), "utf8");
}

const withoutPassword = (): ScaffoldOpts => {
	const { adminPassword: _adminPassword, ...options } = baseOpts();
	return options;
};

const baseOpts = (): ScaffoldOpts => ({
	d: TARGET,
	databaseProvider: "postgres/typeorm",
	authProvider: "auth0",
	issuerBaseUrl: "https://dev-tenant.us.auth0.com",
	audience: "https://api.webapi",
	adminUsername: "admin",
	adminPassword: "Generated1!",
	installDependencies: "no",
});

beforeEach(() => {
	vi.spyOn(process, "cwd").mockReturnValue("/");
	process.env.DECOHERE_BUILDER = "1";
	resetMemfs();
	seedDevcontainerTemplates();
	mockInstall.mockClear();
	mockAsk.mockClear();
	mockCreateAdminDatabaseUser.mockReset();
	mockEnsureSpaApp.mockReset();
	mockEnableConnectionForClient.mockReset();
	mockEnsureSpaApp.mockReturnValue({ client_id: "spa_client_123", reused: false });

	mockCreateAdminDatabaseUser.mockReturnValue({
		user_id: "auth0|admin",
		email: "admin@my-api.example.com",
		password: "Generated1!",
		username: "admin",
	});
});

afterEach(() => {
	resetMemfs();
	vi.restoreAllMocks();
	delete process.env.DECOHERE_BUILDER;
});

describe("scaffoldApi auth0 wiring", () => {
	it("writes AUTH0_ADMIN_* to .env", async () => {
		await scaffoldApi(baseOpts());

		const env = read(".env");
		expect(env).toContain("AUTH0_ADMIN_USER_SUB=auth0|admin");
		expect(env).toContain("AUTH0_ADMIN_USER_EMAIL=admin@my-api.example.com");
		expect(env).not.toContain("PASSWORD");
		expect(env).not.toContain("Generated1!");
		expect(env).toContain("AUTH0_ADMIN_USERNAME=admin");

		expect(mockCreateAdminDatabaseUser).toHaveBeenCalledOnce();

		const readme = read("README.md");
		expect(readme).toContain("## Auth0");
		expect(readme).toContain("AUTH0_ISSUER_BASE_URL");
		expect(readme).toContain("pnpm decohere auth0 login");
		expect(readme).toContain("pnpm decohere auth0 configure");
		expect(readme).toContain("@Authorize");
	});

	it("uses the launcher's password, and writes and prints it nowhere", async () => {
		process.env.DECOHERE_ADMIN_PASSWORD = "From-the-launcher1!";
		const printed: string[] = [];
		vi.spyOn(console, "log").mockImplementation((msg?: unknown) => {
			printed.push(String(msg ?? ""));
		});

		await scaffoldApi(withoutPassword());
		delete process.env.DECOHERE_ADMIN_PASSWORD;

		expect(mockCreateAdminDatabaseUser).toHaveBeenCalledWith(
			expect.objectContaining({ password: "From-the-launcher1!" }),
		);
		expect(read(".env")).not.toContain("From-the-launcher1!");
		expect(printed.join("\n")).not.toContain("From-the-launcher1!");
		expect(mockAsk).not.toHaveBeenCalledWith(expect.stringContaining("password"));
	});

	it("creates no admin user when there's no password", async () => {
		await scaffoldApi(withoutPassword());

		expect(mockCreateAdminDatabaseUser).not.toHaveBeenCalled();
	});

	it("still writes admin env when Auth0 returns an existing user identity", async () => {
		mockCreateAdminDatabaseUser.mockReturnValue({
			user_id: "auth0|existing",
			email: "admin@my-api.example.com",
			password: "Generated1!",
			username: "admin",
		});

		await scaffoldApi(baseOpts());

		const env = read(".env");
		expect(env).toContain("AUTH0_ADMIN_USER_SUB=auth0|existing");
		expect(env).not.toContain("PASSWORD");
		expect(env).not.toContain("Generated1!");
	});

	it("creates the token app and writes its client id to .env", async () => {
		await scaffoldApi(baseOpts());

		expect(mockEnsureM2mApp).toHaveBeenCalledWith("my-api Token");
		expect(mockEnsureClientGrant).toHaveBeenCalledWith(
			"m2m_1",
			expect.any(String),
			expect.arrayContaining(["read:Hello"]),
		);
		expect(read(".env")).toContain("AUTH0_TOKEN_CLIENT_ID=m2m_1");
		expect(read("README.md")).toContain("decohere auth0 token");
		expect(read("README.md")).not.toContain("Postman");
	});

	it("creates the login app and writes its client id to .env", async () => {
		await scaffoldApi(baseOpts());

		expect(read(".env")).toContain("AUTH0_CLIENT_ID=spa_client_123");
		expect(mockEnsureSpaApp).toHaveBeenCalledWith("my-api Dev", ["http://localhost:3000"]);
		expect(mockEnableConnectionForClient).toHaveBeenCalledWith(
			expect.any(String),
			"spa_client_123",
		);
	});

	it("allows the local URL of each API on the login app", async () => {
		await scaffoldApi({ ...baseOpts(), names: ["api", "billing"] });

		expect(mockEnsureSpaApp).toHaveBeenCalledWith("my-api Dev", [
			"http://localhost:3000",
			"http://localhost:3001",
		]);
	});

	it("keeps the client id from .env when Auth0 fails on a later run", async () => {
		await scaffoldApi(baseOpts());
		mockEnsureSpaApp.mockImplementation(() => {
			throw new Error("auth0 apps create failed: Unauthorized");
		});

		await scaffoldApi(baseOpts());

		expect(read(".env")).toContain("AUTH0_CLIENT_ID=spa_client_123");
	});

	it("fails instead of leaving a project with no login app", async () => {
		mockEnsureSpaApp.mockImplementation(() => {
			throw new Error("auth0 apps create failed: Unauthorized");
		});

		await expect(scaffoldApi(baseOpts())).rejects.toThrow(
			/Failed to create the Auth0 login app/,
		);
	});

	it("passes on Auth0's application limit guidance unchanged", async () => {
		mockEnsureSpaApp.mockImplementation(() => {
			throw new Error(
				'Auth0 refused to create SPA "my-api Dev": tenant application limit reached.',
			);
		});

		await expect(scaffoldApi(baseOpts())).rejects.toThrow(
			/^Auth0 refused to create SPA "my-api Dev": tenant application limit reached\.$/,
		);
	});

	it("scaffolds a thin ability.factory extension point (not CASL infrastructure)", async () => {
		await scaffoldApi(baseOpts());

		const ability = read("projects/api/src/auth/ability.factory.ts");
		expect(ability).toContain("export function defineAbilitiesFor");
		expect(ability).toContain("export function mapPrincipal");
		expect(ability).toContain("defaultDefineAbilitiesFor");
		expect(ability).toContain("createPrincipalFromPayload");
		expect(ability).toContain("AUTH0_ADMIN_USER_SUB");
		expect(ability).not.toContain("@casl/ability");
		expect(ability).not.toContain("AbilityBuilder");
		expect(ability).not.toContain("createMongoAbility");

		const main = read("projects/api/src/main.ts");
		expect(main).toContain(".withAuth(defineAbilitiesFor, { principalMapper: mapPrincipal })");
		expect(main).not.toContain("createAbilityFactory");

		const rootPkg = JSON.parse(read("package.json")) as {
			dependencies?: Record<string, string>;
		};
		const apiPkg = JSON.parse(read("projects/api/package.json")) as {
			dependencies?: Record<string, string>;
		};
		expect(rootPkg.dependencies?.["@casl/ability"]).toBeUndefined();
		expect(apiPkg.dependencies?.["@casl/ability"]).toBeUndefined();
	});
});
