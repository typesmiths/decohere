import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resetMemfs } from "@decohere/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { seedDevcontainerTemplates } from "./seed-devcontainer-templates.js";

/**
 * Feature-level coverage for Auth0 + Postman wiring.
 *
 * webapi.spec.ts only asserts install behaviour with authProvider:"none" and
 * stubs auth0-cli as isInstalled:false — so missing .env / empty auth0ClientId
 * on re-scaffold never failed the suite.
 */

const {
	mockAsk,
	mockPick,
	mockInstall,
	mockCreateAdminDatabaseUser,
	mockEnsureSpaApp,
	mockEnableConnectionForClient,
	mockIsInstalled,
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
		login: () => true,
		listTenants: () => [{ name: "dev-tenant.us.auth0.com", active: true }],
		listApis: () => [{ name: "webapi API", identifier: "https://api.webapi" }],
		updateApiScopes: vi.fn(),
		createAdminDatabaseUser: mockCreateAdminDatabaseUser,
		ensureSpaApp: mockEnsureSpaApp,
		createSpaApp: vi.fn(() => {
			throw new Error("createSpaApp should not be called — use ensureSpaApp");
		}),
		enableConnectionForClient: mockEnableConnectionForClient,
		generateAdminPassword: () => "Generated1!",
	};
});

vi.mock("../src/webapi/features/biome-format.js", () => ({
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

const baseOpts = (): ScaffoldOpts => ({
	d: TARGET,
	databaseProvider: "postgres/typeorm",
	authProvider: "auth0",
	issuerBaseUrl: "https://dev-tenant.us.auth0.com",
	audience: "https://api.webapi",
	adminUsername: "admin",
	adminPassword: "Generated1!",
	postmanProvider: "local",
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

	mockCreateAdminDatabaseUser.mockReturnValue({
		user_id: "auth0|admin",
		email: "admin@my-api.example.com",
		password: "Generated1!",
		username: "admin",
	});
	mockEnsureSpaApp.mockReturnValue({ client_id: "spa_client_123", reused: false });
});

afterEach(() => {
	resetMemfs();
	vi.restoreAllMocks();
	delete process.env.DECOHERE_BUILDER;
});

describe("scaffoldApi auth0 + postman wiring", () => {
	it("writes AUTH0_ADMIN_* to .env and auth0ClientId into the Postman environment", async () => {
		await scaffoldApi(baseOpts());

		const env = read(".env");
		expect(env).toContain("AUTH0_ADMIN_USER_SUB=auth0|admin");
		expect(env).toContain("AUTH0_ADMIN_USER_EMAIL=admin@my-api.example.com");
		expect(env).toContain("AUTH0_ADMIN_USER_PASSWORD=Generated1!");
		expect(env).toContain("AUTH0_ADMIN_USERNAME=admin");

		const postmanEnv = read("postman/environments/my-api-Local.environment.yaml");
		expect(postmanEnv).toMatch(/key: auth0ClientId\n\s+value: spa_client_123/);
		expect(mockEnsureSpaApp).toHaveBeenCalledWith(
			"my-api Postman",
			expect.arrayContaining(["https://oauth.pstmn.io/v1/callback"]),
		);
		expect(mockCreateAdminDatabaseUser).toHaveBeenCalledOnce();

		const readme = read("README.md");
		expect(readme).toContain("## Auth0");
		expect(readme).toContain("AUTH0_ISSUER_BASE_URL");
		expect(readme).toContain("npx @decohere/create auth0 login");
		expect(readme).toContain("npx @decohere/create auth0 configure");
		expect(readme).toContain("@Authorize");
		expect(readme).toContain("## Postman");
		expect(readme).toContain("Local View");
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
		expect(env).toContain("AUTH0_ADMIN_USER_PASSWORD=Generated1!");
	});

	it("writes a non-empty auth0ClientId when the SPA app is reused", async () => {
		mockEnsureSpaApp.mockReturnValue({ client_id: "spa_reused", reused: true });

		await scaffoldApi(baseOpts());

		const postmanEnv = read("postman/environments/my-api-Local.environment.yaml");
		expect(postmanEnv).toMatch(/key: auth0ClientId\n\s+value: spa_reused/);
		expect(postmanEnv).not.toMatch(/key: auth0ClientId\n\s+value: ""/);

		const collectionAuth = read(
			"postman/collections/my-api WebAPI/.resources/definition.yaml",
		);
		expect(collectionAuth).toMatch(/clientId:\s*spa_reused/);
	});

	it("preserves existing auth0ClientId when ensureSpaApp fails on re-scaffold", async () => {
		await scaffoldApi(baseOpts());

		mockEnsureSpaApp.mockImplementation(() => {
			throw new Error("auth0 apps create failed: Unauthorized");
		});

		await scaffoldApi(baseOpts());

		const postmanEnv = read("postman/environments/my-api-Local.environment.yaml");
		expect(postmanEnv).toMatch(/key: auth0ClientId\n\s+value: spa_client_123/);
		expect(postmanEnv).not.toMatch(/key: auth0ClientId\n\s+value: ""/);
	});

	it("fails the scaffold instead of writing an empty auth0ClientId", async () => {
		mockEnsureSpaApp.mockImplementation(() => {
			throw new Error("auth0 apps create failed: Unauthorized");
		});

		await expect(scaffoldApi(baseOpts())).rejects.toThrow(/auth0ClientId would be empty/);
	});

	it("surfaces Auth0 application-limit guidance without writing an empty auth0ClientId", async () => {
		mockEnsureSpaApp.mockImplementation(() => {
			throw new Error(
				[
					'Auth0 refused to create SPA "my-api Postman": tenant application limit reached.',
					"This tenant already has 3 application(s):",
					"  - ledger Postman (spa_a)",
					"",
					"Fix: Auth0 Dashboard → Applications → Applications → delete unused apps,",
					'then re-run the scaffold (or choose Postman "none" to skip SPA creation).',
				].join("\n"),
			);
		});

		let thrown: unknown;
		try {
			await scaffoldApi(baseOpts());
		} catch (err) {
			thrown = err;
		}
		expect(thrown).toBeInstanceOf(Error);
		const message = (thrown as Error).message;
		expect(message).toMatch(/tenant application limit reached/);
		expect(message).toMatch(/delete unused apps/i);
		expect(message).not.toMatch(/auth0ClientId would be empty/);
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
