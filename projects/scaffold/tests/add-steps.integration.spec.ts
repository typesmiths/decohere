/**
 * Behavior: each `decohere add` step on a workspace freshly made from the web API recipe, run the
 * way the bin runs it (files in memfs). Each step once, on top of the recipe and the steps it
 * needs: what it adds, that running it again changes nothing, that `--dry-run` writes nothing, and
 * that an app.ts the user rewrote is left alone with the lines to add printed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedTemplates } from "./seed-templates.js";

const { mockEnsureSpaApp, mockCreateApi, mockCreateAdmin } = vi.hoisted(() => ({
	mockEnsureSpaApp: vi.fn(() => ({ client_id: "spa_123", reused: true })),
	mockCreateApi: vi.fn(() => ({ identifier: "https://api.my-app" })),
	mockCreateAdmin: vi.fn(() => ({
		user_id: "auth0|admin",
		email: "admin@my-app.example.com",
		password: "x",
		username: "admin",
	})),
}));

vi.mock(import("../src/webapi/auth0-cli.js"), async (importOriginal) => ({
	...(await importOriginal()),
	isInstalled: () => true,
	login: () => true,
	listTenants: () => [{ name: "dev-tenant.us.auth0.com", active: true }],
	listApis: () => [],
	listApiScopes: () => [],
	updateApiScopes: vi.fn(),
	createApi: mockCreateApi,
	ensureSpaApp: mockEnsureSpaApp,
	enableConnectionForClient: vi.fn(),
	ensureM2mApp: () => ({ client_id: "m2m_123", reused: false }),
	ensureClientGrant: vi.fn(),
	createAdminDatabaseUser: mockCreateAdmin,
}));

vi.mock("../src/webapi/format-files.js", () => ({ formatScaffoldedFiles: vi.fn() }));

const PROGRAM = pathToFileURL(new URL("../src/program.ts", import.meta.url).pathname).href;
const APP = "/my-app/projects/api/src/app.ts";

async function decohere(...args: string[]): Promise<number> {
	vi.spyOn(process, "cwd").mockReturnValue("/");
	const argv = [process.execPath, "/node_modules/.bin/decohere", ...args];
	const { runCli } = (await import(PROGRAM)) as typeof import("../src/program.js");
	return runCli(argv);
}

/** A new workspace: the workspace template and the web API recipe, nothing added. */
async function createWorkspace(): Promise<void> {
	const code = await decohere(
		"create",
		"webapi",
		"my-app",
		"--database",
		"none",
		"--auth",
		"none",
		"--install",
		"no",
	);
	expect(code).toBe(0);
}

const files = () => vol.toJSON("/my-app");
const read = (path: string) => readFileSync(`/my-app/${path}`, "utf8");

function captureLogs(): string[] {
	const logs: string[] = [];
	vi.spyOn(console, "log").mockImplementation((message?: unknown) => {
		logs.push(String(message ?? ""));
	});
	return logs;
}

beforeAll(async () => {
	await import(PROGRAM);
}, 60_000);

beforeEach(() => {
	resetMemfs();
	seedTemplates();
	process.env.DECOHERE_BUILDER = "1";
});

afterEach(() => {
	resetMemfs();
	vi.restoreAllMocks();
	delete process.env.DECOHERE_BUILDER;
	delete process.env.DECOHERE_ADMIN_PASSWORD;
});

describe.each([
	{ orm: "mikro-orm", plugin: "mikroOrm", entity: "SampleEntityMapping" },
	{ orm: "typeorm", plugin: "typeOrm", entity: "SampleEntity" },
])("decohere add postgres --orm $orm", ({ orm, plugin, entity }) => {
	const addPostgres = () => decohere("add", "postgres", "--orm", orm, "-d", "my-app");

	it("adds Postgres to the Dev Container, a database and a sample table to the app", async () => {
		await createWorkspace();

		expect(await addPostgres()).toBe(0);

		const app = read("projects/api/src/app.ts");
		expect(app).toContain(`${plugin}({`);
		expect(app).toContain(`entities: [${entity}],`);
		expect(app).toContain('import { migrations } from "./migrations/index.js";');
		expect(read("projects/api/src/db.ts")).toContain("db.run(app");
		const migrations = vol.readdirSync("/my-app/projects/api/src/migrations") as string[];
		expect(migrations).toEqual([
			expect.stringMatching(/^\d{8}-\d{6}-create-sample-entity\.ts$/),
			"index.ts",
		]);
		expect(read("projects/api/src/migrations/index.ts")).toContain(migrations[0].slice(0, -3));
		expect(read(".devcontainer/docker-compose.yml")).toContain("image: postgres:16");
		expect(read(".devcontainer/Dockerfile")).toContain("postgresql-client");
		expect(read("config/config.yaml")).toContain("- name: api");
		expect(read(".env")).toContain("API_DB_NAME=my_app_api_dev");
		const manifest = JSON.parse(read("projects/api/package.json")) as {
			dependencies: Record<string, string>;
			decohere: { steps: string[] };
		};
		expect(manifest.dependencies).toHaveProperty(`@decohere/data-${orm}`);
		expect(manifest.decohere.steps).toEqual(["postgres", orm]);
	});

	it("changes nothing when run again", async () => {
		await createWorkspace();
		await addPostgres();
		const before = files();

		expect(await addPostgres()).toBe(0);

		expect(files()).toEqual(before);
	});

	it("writes nothing with --dry-run, and lists what it would change", async () => {
		await createWorkspace();
		const before = files();
		const logs = captureLogs();

		await decohere("add", "postgres", "--orm", orm, "--dry-run", "-d", "my-app");

		expect(files()).toEqual(before);
		expect(logs.join("\n")).toContain("projects/api/src/app.ts");
	});

	it("leaves an app.ts it can't change safely, and says what to add", async () => {
		await createWorkspace();
		const custom = "export const app = buildMyOwnApp();\n";
		writeFileSync(APP, custom);
		const logs = captureLogs();

		await addPostgres();

		expect(readFileSync(APP, "utf8")).toBe(custom);
		expect(logs.join("\n")).toContain("projects/api/src/app.ts");
		expect(logs.join("\n")).toContain(`import { ${plugin} } from "@decohere/data-${orm}";`);
	});
});

describe("decohere add auth0", () => {
	const addAuth0 = () => decohere("add", "auth0", "-d", "my-app");

	it("wires auth() in, and gives Hello and its test a token check", async () => {
		await createWorkspace();

		expect(await addAuth0()).toBe(0);

		expect(read("projects/api/src/app.ts")).toMatch(
			/\.use\(config\(new YamlDataSource\(\{ app: "api" \}\), EnvDataSource\)\)\n\s*\.use\(auth\(\)\)/,
		);
		expect(read("projects/api/src/controllers/hello.controller.ts")).toContain(
			'@Authorize("read", "Hello")',
		);
		expect(read("projects/api/tests/hello.controller.spec.ts")).toContain(".use(auth())");
		expect(read("config/config.yaml")).toContain("discoveryUrl: ${AUTH0_ISSUER_BASE_URL}");
		expect(read(".env")).toContain("AUTH0_CLIENT_ID=spa_123");
		expect(read("README.md")).toContain("## Auth0");
	});

	it("changes nothing when run again", async () => {
		await createWorkspace();
		await addAuth0();
		const before = files();

		expect(await addAuth0()).toBe(0);

		expect(files()).toEqual(before);
	});

	it("keeps a Hello controller the user changed, and says where the step's version is", async () => {
		await createWorkspace();
		const controller = "/my-app/projects/api/src/controllers/hello.controller.ts";
		const changed = `${readFileSync(controller, "utf8")}\n// mine\n`;
		writeFileSync(controller, changed);
		const logs = captureLogs();

		await addAuth0();

		expect(readFileSync(controller, "utf8")).toBe(changed);
		expect(logs.join("\n")).toContain("steps/auth0/projects/app-name/src/controllers");
	});

	it("touches neither Auth0 nor the disk with --dry-run", async () => {
		await createWorkspace();
		const before = files();

		await decohere("add", "auth0", "--dry-run", "-d", "my-app");

		expect(files()).toEqual(before);
		expect(mockEnsureSpaApp).not.toHaveBeenCalled();
	});
});

describe("decohere add users", () => {
	const addUsers = () => decohere("add", "users", "-d", "my-app");

	async function withPostgresAndAuth0(): Promise<void> {
		await createWorkspace();
		await decohere("add", "postgres", "-d", "my-app");
		await decohere("add", "auth0", "-d", "my-app");
	}

	it("gives each user a local profile, and seeds the admin", async () => {
		await withPostgresAndAuth0();
		process.env.DECOHERE_ADMIN_PASSWORD = "From-the-launcher1!";

		expect(await addUsers()).toBe(0);

		const app = read("projects/api/src/app.ts");
		expect(app).toContain(".use(auth(defineAbilitiesFor, { principalMapper: mapPrincipal }))");
		expect(app).toContain("entities: [UserEntityMapping, SampleEntityMapping],");
		expect(app).toContain("repositories: [UserEntityRepository, SampleEntityRepository],");
		expect(app).toContain("seed: seedAdmin,");
		expect(app).toContain("services.registerRequestScoped(UserService);");
		expect(read("projects/api/src/controllers/hello.controller.ts")).toContain(
			"this.users.ensureFromPrincipal",
		);
		expect(read("projects/api/tests/hello.controller.spec.ts")).toContain(
			"services.registerSingleton(UserService, {",
		);
		const index = read("projects/api/src/migrations/index.ts");
		expect(index.indexOf("create_sample_entity")).toBeLessThan(
			index.indexOf("create_user_entity"),
		);
		expect(read(".env")).toContain("AUTH0_ADMIN_USER_SUB=auth0|admin");
		expect(read(".env")).not.toContain("From-the-launcher1!");
	});

	it("changes nothing when run again", async () => {
		await withPostgresAndAuth0();
		await addUsers();
		const before = files();

		expect(await addUsers()).toBe(0);

		expect(files()).toEqual(before);
	});

	it("says what it needs first, and changes nothing, in an app without Postgres", async () => {
		await createWorkspace();
		await decohere("add", "auth0", "-d", "my-app");
		const before = files();
		const logs = captureLogs();

		await addUsers();

		expect(files()).toEqual(before);
		expect(logs.join("\n")).toContain("decohere add postgres");
	});

	it("leaves an app.ts it can't change safely, and says what to add", async () => {
		await withPostgresAndAuth0();
		const source = readFileSync(APP, "utf8").replace(
			/\.withServices\(\(services\) => \{[^}]*\}\)/,
			".withServices(registerMyServices)",
		);
		expect(source).toContain("registerMyServices");
		writeFileSync(APP, source);
		const logs = captureLogs();

		await addUsers();

		expect(readFileSync(APP, "utf8")).toBe(source);
		const told = logs.join("\n");
		expect(told).toContain("register UserService, request scoped, in .withServices()");
		expect(told).toContain("replace .use(auth()) with");
	});
});
