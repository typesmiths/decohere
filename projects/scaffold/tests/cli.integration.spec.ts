/**
 * Behavior: running the create CLI the way Node runs the package bin writes a webapi tree.
 *
 * One suite — every example uses the same launch:
 *   argv = [node, /node_modules/.bin/decohere, …userArgs]
 * passed to `runCli`, which the bin entry calls (writes go to memfs).
 *
 * Examples are argv permutations only.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resetMemfs } from "@decohere/testing";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { seedDevcontainerTemplates } from "./seed-devcontainer-templates.js";

const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");

const {
	mockAsk,
	mockPick,
	mockInstall,
	mockIsInstalled,
	mockLogin,
	mockListTenants,
	mockListApis,
	mockUpdateApiScopes,
	mockCreateApi,
	mockListApiScopes,
	mockEnsureSpaApp,
	mockEnableConnection,
	mockAssignUserPermissions,
	mockEnsureM2mApp,
	mockEnsureClientGrant,
	mockRequestAccessToken,
} = vi.hoisted(() => ({
	mockAsk: vi.fn((_q: string, fallback = "") => Promise.resolve(fallback)),
	mockPick: vi.fn(
		<T>(_label: string, items: T[], _display: (item: T) => string): Promise<T | null> =>
			Promise.resolve(items[0] ?? null),
	),
	mockInstall: vi.fn().mockResolvedValue({ message: "", data: [] }),
	mockIsInstalled: vi.fn(() => false),
	mockLogin: vi.fn(() => true),
	mockListTenants: vi.fn(() => [] as Array<{ name: string; active?: boolean }>),
	mockListApis: vi.fn(() => [] as Array<{ name: string; identifier: string }>),
	mockUpdateApiScopes: vi.fn(),
	mockCreateApi: vi.fn(() => ({ identifier: "https://api.my-app" })),
	mockEnsureSpaApp: vi.fn(() => ({ client_id: "spa_123", reused: true })),
	mockEnableConnection: vi.fn(),
	mockListApiScopes: vi.fn(() => [] as string[]),
	mockAssignUserPermissions: vi.fn(),
	mockEnsureM2mApp: vi.fn(() => ({ client_id: "m2m_123", reused: false })),
	mockEnsureClientGrant: vi.fn(),
	mockRequestAccessToken: vi.fn(() => "a-token"),
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
		login: mockLogin,
		listTenants: mockListTenants,
		listApis: mockListApis,
		updateApiScopes: mockUpdateApiScopes,
		ensureSpaApp: mockEnsureSpaApp,
		enableConnectionForClient: mockEnableConnection,
		createApi: mockCreateApi,
		listApiScopes: mockListApiScopes,
		assignUserPermissions: mockAssignUserPermissions,
		ensureM2mApp: mockEnsureM2mApp,
		ensureClientGrant: mockEnsureClientGrant,
		requestAccessToken: mockRequestAccessToken,
	};
});

vi.mock("../src/webapi/features/biome-format.js", () => ({
	formatScaffoldedFiles: vi.fn(),
}));

const NODE = process.execPath;
const PROGRAM_FILE = realFs.realpathSync(
	fileURLToPath(new URL("../src/program.ts", import.meta.url)),
);
/** Same argv[1] shape npm/npx use for the package bin. */
const NPM_BIN = "/node_modules/.bin/decohere";

/** Feature flags only — does not skip install (use with builder env or `--install no`). */
const NON_INTERACTIVE_FEATURES = ["--database", "none", "--auth", "none"] as const;

const NON_INTERACTIVE = [...NON_INTERACTIVE_FEATURES, "--install", "no"] as const;

function expectWebapiTree(root: string, projectName = basename(root)): void {
	expect(projectName.length, "projectName required when root has no basename").toBeGreaterThan(
		0,
	);
	const workspaceRoot = `/${projectName}`;

	expect(existsSync(join(root, "package.json")), `${root}/package.json`).toBe(true);
	expect(
		existsSync(join(root, "projects/api/Dockerfile")),
		`${root}/projects/api/Dockerfile`,
	).toBe(true);
	expect(existsSync(join(root, "tsconfig.json")), `${root}/tsconfig.json`).toBe(true);
	expect(existsSync(join(root, "vitest.config.ts")), `${root}/vitest.config.ts`).toBe(true);
	const vitestConfig = readFileSync(join(root, "vitest.config.ts"), "utf8");
	expect(vitestConfig).toContain('from "@decohere/forge/vitest"');
	expect(vitestConfig).toContain("forgeBuild");
	expect(
		existsSync(join(root, "projects/api/package.json")),
		`${root}/projects/api/package.json`,
	).toBe(true);
	expect(
		existsSync(join(root, "projects/api/src/main.ts")),
		`${root}/projects/api/src/main.ts`,
	).toBe(true);
	expect(readFileSync(join(root, "projects/api/src/main.ts"), "utf8")).toContain(
		"withHealth()",
	);
	expect(readFileSync(join(root, "projects/api/src/main.ts"), "utf8")).toContain(
		"Number(process.env.PORT ?? 3000)",
	);
	expect(readFileSync(join(root, "projects/api/src/main.ts"), "utf8")).toContain(
		"scribe.withPinoPretty().and.withPinoRoll",
	);
	expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain("logs");
	expect(
		existsSync(join(root, "projects/api/src/controllers/hello.controller.ts")),
		`${root}/projects/api/src/controllers/hello.controller.ts`,
	).toBe(true);

	const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
		scripts?: Record<string, string>;
		dependencies?: Record<string, string>;
		devDependencies?: Record<string, string>;
	};
	expect(pkg.scripts?.build).toBeTruthy();
	expect(pkg.scripts?.start).toBeTruthy();
	expect(pkg.scripts?.dev).toBeTruthy();
	// Settings come from the environment; the dev script loads .env explicitly when present.
	expect(pkg.scripts?.dev).toContain("--env-file-if-exists .env");
	expect(pkg.dependencies?.["pino-pretty"]).toBeTruthy();
	expect(pkg.dependencies?.["pino-roll"]).toBeTruthy();
	expect(pkg.devDependencies?.["@decohere/forge"]).toBeTruthy();

	const apiPkg = JSON.parse(readFileSync(join(root, "projects/api/package.json"), "utf8")) as {
		private?: boolean;
	};
	expect(apiPkg.private).toBe(true);

	const dockerfile = readFileSync(join(root, "projects/api/Dockerfile"), "utf8");
	expect(dockerfile).toContain("COPY .package/ ./");
	expect(dockerfile).toContain('CMD ["node", "es6/src/main.js"]');
	expect(dockerfile).not.toMatch(/^RUN /m);
	expect(dockerfile).not.toMatch(/pnpm install/);
	expect(dockerfile).not.toContain("npm_token");
	expect(pkg.scripts?.package).toBe("pnpm run build && forge package");

	const devcontainerJson = readFileSync(join(root, ".devcontainer/devcontainer.json"), "utf8");
	expect(devcontainerJson).toContain(`"workspaceFolder": "${workspaceRoot}"`);
	expect(devcontainerJson).toContain(
		'"postCreateCommand": "bash .devcontainer/post-create.sh"',
	);
	expect(devcontainerJson).toContain(
		'"updateContentCommand": "bash .devcontainer/post-create.sh"',
	);
	expect(devcontainerJson).not.toContain("postStartCommand");

	const postCreate = readFileSync(join(root, ".devcontainer/post-create.sh"), "utf8");
	expect(postCreate).toContain("pnpm install --frozen-lockfile");
	expect(postCreate).toContain("pnpm install");
	expect(postCreate).toContain("pnpm exec biome check --write .");

	const initialize = readFileSync(join(root, ".devcontainer/initialize.sh"), "utf8");
	expect(initialize).toContain('gh_root="$HOME/.config/decohere/gh"');
	expect(initialize).not.toContain("gh-auth");
	expect(initialize).not.toContain("python3");
	// Opening the Dev Container asks nothing and never needs a login.
	expect(initialize).not.toMatch(/prompt_yn|\/dev\/tty|\bread\b|npm|\.cursor/);

	const compose = readFileSync(join(root, ".devcontainer/docker-compose.yml"), "utf8");
	expect(compose).toContain(`..:${workspaceRoot}`);
	expect(compose).toContain(`webapi-node-modules:${workspaceRoot}/node_modules`);
	expect(compose).toContain("command: sleep infinity");
	expect(compose).not.toContain("codebase-rag");
	expect(compose).not.toContain("npm-auth");
	expect(compose).not.toContain("NPM_CONFIG_USERCONFIG");
	expect(compose).toContain(
		`\${HOME}/.config/decohere/gh/${projectName}:/home/node/.config/gh`,
	);
	expect(compose).toContain(`\${HOME}/.config/decohere/gh/${projectName}.env`);
	expect(compose).not.toContain("gh-auth");
	expect(compose).not.toContain("./gh.env");
	expect(compose).toContain("bashhistory:/commandhistory");
	expect(compose).toMatch(/^ {2}bashhistory:\s*$/m);
	expect(compose).toContain(
		`\${XDG_RUNTIME_DIR:-\${HOME}/.config/decohere}/decohere-auth0/${projectName}:/home/node/.config/auth0`,
	);
	expect(compose).not.toMatch(/^ {2}auth0-login:\s*$/m);
	expect(initialize).toContain(
		'"${XDG_RUNTIME_DIR:-$HOME/.config/decohere}/decohere-auth0/$project"',
	);

	const appDevDockerfile = readFileSync(join(root, ".devcontainer/Dockerfile"), "utf8");
	expect(appDevDockerfile).toMatch(/^FROM ghcr\.io\/typesmiths\/decohere\/devcontainer:/m);
	expect(appDevDockerfile).toContain(`RUN mkdir -p ${workspaceRoot}/node_modules && chown`);
	expect(appDevDockerfile).not.toContain("apt-get install -y --no-install-recommends gh");

	const gitignore = readFileSync(join(root, ".gitignore"), "utf8");
	expect(gitignore).not.toContain("gh.env");
	expect(gitignore).not.toContain(".cursor");

	for (const removed of [
		"postman",
		".postman",
		".devcontainer/post-start.sh",
		".devcontainer/tty-prompt.sh",
		".devcontainer/codebase-rag-mcp.ts",
		".devcontainer/codebase-rag.env.example",
		".devcontainer/npm-auth",
	]) {
		expect(existsSync(join(root, removed)), removed).toBe(false);
	}
}

/** argv as `node node_modules/.bin/decohere …args`, run in process; resolves to the exit code. */
async function runCliAsNodeBin(
	userArgs: string[],
	options?: { resetFs?: boolean; builder?: boolean },
): Promise<number> {
	vi.resetModules();
	if (options?.resetFs !== false) {
		resetMemfs();
		seedDevcontainerTemplates();
	}
	vi.spyOn(process, "cwd").mockReturnValue("/");
	if (options?.builder === false) {
		delete process.env.DECOHERE_BUILDER;
	} else {
		process.env.DECOHERE_BUILDER = "1";
	}
	const argv = [NODE, NPM_BIN, ...userArgs];
	process.argv = argv;

	const { runCli } = (await import(
		`${pathToFileURL(PROGRAM_FILE).href}?t=${Date.now()}`
	)) as typeof import("../src/program.js");
	return runCli(argv);
}

// The first import transforms the CLI's whole module graph (about a second, more on a loaded
// machine); later ones reuse it. Done once here so each test's timeout covers the CLI's work,
// not that one-off load, which made the first test time out under a full parallel run.
beforeAll(async () => {
	await import(pathToFileURL(PROGRAM_FILE).href);
}, 60_000);

beforeEach(() => {
	mockInstall.mockClear();
	mockAsk.mockClear();
	mockPick.mockClear();
	mockIsInstalled.mockReset();
	mockIsInstalled.mockReturnValue(false);
	mockLogin.mockReset();
	mockLogin.mockReturnValue(true);
	mockListTenants.mockReset();
	mockListTenants.mockReturnValue([]);
	mockListApis.mockReset();
	mockListApis.mockReturnValue([]);
	mockUpdateApiScopes.mockReset();
	mockCreateApi.mockReset();
	mockCreateApi.mockReturnValue({ identifier: "https://api.my-app" });
	mockEnsureSpaApp.mockReset();
	mockEnsureSpaApp.mockReturnValue({ client_id: "spa_123", reused: true });
	mockEnableConnection.mockReset();
	mockListApiScopes.mockReset();
	mockListApiScopes.mockReturnValue([]);
	mockAssignUserPermissions.mockReset();
});

afterEach(() => {
	resetMemfs();
	vi.restoreAllMocks();
	delete process.env.DECOHERE_BUILDER;
	delete process.env.DECOHERE_PROJECT_NAME;
});

describe("scaffolder writes a webapi project", () => {
	it("writes files for: webapi my-app (npm create after stealing -d)", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...NON_INTERACTIVE]);
		expectWebapiTree("/my-app");
	});

	// Without these, a new app failed its own typecheck (`Cannot find name 'process'`) and its
	// install ended in ERR_PNPM_IGNORED_BUILDS on current pnpm.
	it("declares the Node types the generated code needs to typecheck", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...NON_INTERACTIVE]);

		const pkg = JSON.parse(readFileSync("/my-app/package.json", "utf8"));
		expect(pkg.devDependencies["@types/node"]).toBeTruthy();
		expect(readFileSync("/my-app/projects/api/src/main.ts", "utf8")).toContain("process.env");
	});

	it("tells pnpm what to do with each dependency's install script", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...NON_INTERACTIVE]);

		const workspace = readFileSync("/my-app/pnpm-workspace.yaml", "utf8");
		expect(workspace).toContain("allowBuilds:");
		expect(workspace).toContain('"@swc/core": false');
		expect(workspace).toContain("esbuild: false");
	});

	// The base image ends as a non-root user, and a build argument doesn't carry over from it, so
	// the app's own layers failed with "Permission denied" and the container never built.
	it("builds the Dev Container's own layers as root, then hands back to the node user", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...NON_INTERACTIVE]);

		const lines = readFileSync("/my-app/.devcontainer/Dockerfile", "utf8")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
		const ownership = lines.findIndex((line) => line.includes("/my-app/node_modules"));

		expect(lines[0]).toMatch(/^FROM /);
		expect(lines).toContain("ARG USERNAME=node");
		expect(ownership).toBeGreaterThan(lines.indexOf("USER root"));
		expect(lines.indexOf("USER root")).toBeGreaterThan(0);
		expect(lines.at(-1)).toBe("USER ${USERNAME}");
	});

	// The Postgres layer hands back to node, because it can also be added to a finished Dockerfile.
	it("creates node_modules as root in an app with a database too", async () => {
		await runCliAsNodeBin([
			"create",
			"webapi",
			"my-app",
			...NON_INTERACTIVE,
			"--database",
			"postgres/typeorm",
		]);

		const lines = readFileSync("/my-app/.devcontainer/Dockerfile", "utf8")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
		const ownership = lines.findIndex((line) => line.includes("/my-app/node_modules"));
		const userBefore = lines.slice(0, ownership).findLast((line) => line.startsWith("USER "));

		expect(userBefore).toBe("USER root");
		expect(lines.at(-1)).toBe("USER ${USERNAME}");
	});

	it("writes files for: webapi -d my-app (npx / direct bin)", async () => {
		await runCliAsNodeBin(["create", "webapi", "-d", "my-app", ...NON_INTERACTIVE]);
		expectWebapiTree("/my-app");
	});

	it("writes files for: webapi ./apps/api (relative directory)", async () => {
		await runCliAsNodeBin(["create", "webapi", "./apps/api", ...NON_INTERACTIVE]);
		expectWebapiTree("/apps/api");
	});

	it("writes files into cwd for: webapi (no directory)", async () => {
		process.env.DECOHERE_PROJECT_NAME = "cwd-app";
		await runCliAsNodeBin(["create", "webapi", ...NON_INTERACTIVE]);
		expectWebapiTree("/", "cwd-app");
	});

	it("uses DECOHERE_PROJECT_NAME when scaffolding into /workspace", async () => {
		process.env.DECOHERE_PROJECT_NAME = "test1";
		await runCliAsNodeBin(["create", "webapi", "-d", "/workspace", ...NON_INTERACTIVE]);

		expectWebapiTree("/workspace", "test1");

		const settings = JSON.parse(
			readFileSync(join("/workspace", ".vscode/settings.json"), "utf8"),
		) as { "window.title"?: string };
		expect(settings["window.title"]).toContain("test1");

		const pkg = JSON.parse(readFileSync(join("/workspace", "package.json"), "utf8")) as {
			name?: string;
		};
		expect(pkg.name).toBe("test1.api");
	});
});

describe("scaffolder install behavior", () => {
	it("installs dependencies when not in builder env and without --install no", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...NON_INTERACTIVE_FEATURES], {
			builder: false,
		});
		expectWebapiTree("/my-app");
		expect(mockInstall).toHaveBeenCalledOnce();
	});

	it("does not install when DECOHERE_BUILDER=1 even without --install no", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...NON_INTERACTIVE_FEATURES]);
		expectWebapiTree("/my-app");
		expect(mockInstall).not.toHaveBeenCalled();
	});

	it("does not install when --install no is set", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...NON_INTERACTIVE], {
			builder: false,
		});
		expectWebapiTree("/my-app");
		expect(mockInstall).not.toHaveBeenCalled();
	});
});

function readJson(path: string): {
	scripts?: Record<string, string>;
	name?: string;
	private?: boolean;
} {
	return JSON.parse(readFileSync(path, "utf8")) as {
		scripts?: Record<string, string>;
		name?: string;
		private?: boolean;
	};
}

function expectApiProject(root: string, apiName: string): void {
	expect(existsSync(join(root, `projects/${apiName}/package.json`))).toBe(true);
	expect(existsSync(join(root, `projects/${apiName}/src/main.ts`))).toBe(true);
	const apiPkg = readJson(join(root, `projects/${apiName}/package.json`));
	expect(apiPkg.private).toBe(true);
	expect(apiPkg.name).toBe(`@${root === "/" ? "cwd-app" : root.slice(1)}/${apiName}`);
}

describe("scaffolder names APIs and can add more later", () => {
	it("writes projects/billing when --name billing", async () => {
		await runCliAsNodeBin([
			"create",
			"webapi",
			"my-app",
			"--name",
			"billing",
			...NON_INTERACTIVE,
		]);

		expect(existsSync("/my-app/projects/api")).toBe(false);
		expectApiProject("/my-app", "billing");

		const pkg = readJson("/my-app/package.json");
		expect(pkg.scripts?.start).toContain("projects/billing");
		expect(pkg.scripts?.["start:billing"]).toContain("projects/billing");

		expect(pkg.scripts?.["package:billing"]).toContain("forge package @my-app/billing");
		expect(readFileSync("/my-app/projects/billing/Dockerfile", "utf8")).toContain(
			"COPY .package/ ./",
		);
		expect(existsSync("/my-app/projects/api/Dockerfile")).toBe(false);
		expect(existsSync("/my-app/Dockerfile")).toBe(false);
	});

	it("writes multiple APIs for repeated --name", async () => {
		await runCliAsNodeBin([
			"create",
			"webapi",
			"my-app",
			"--name",
			"api",
			"--name",
			"billing",
			...NON_INTERACTIVE,
		]);

		expectApiProject("/my-app", "api");
		expectApiProject("/my-app", "billing");

		const pkg = readJson("/my-app/package.json");
		expect(pkg.scripts?.start).toContain("projects/api");
		expect(pkg.scripts?.["start:billing"]).toContain("projects/billing");

		expect(existsSync("/my-app/projects/api/Dockerfile")).toBe(true);
		expect(existsSync("/my-app/projects/billing/Dockerfile")).toBe(true);
	});

	it("adds a named API to an existing workspace without clobbering the first", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...NON_INTERACTIVE]);
		writeFileSync("/my-app/biome.json", '{ "custom": true }\n');
		writeFileSync("/my-app/projects/api/Dockerfile", "# keep-api-dockerfile\n");
		writeFileSync("/my-app/vitest.config.ts", "// keep-vitest-config\n");

		await runCliAsNodeBin(["add", "api", "billing", "-d", "my-app", ...NON_INTERACTIVE], {
			resetFs: false,
		});

		expect(readFileSync("/my-app/biome.json", "utf8")).toContain("custom");
		expect(readFileSync("/my-app/projects/api/Dockerfile", "utf8")).toBe(
			"# keep-api-dockerfile\n",
		);
		expect(readFileSync("/my-app/vitest.config.ts", "utf8")).toBe("// keep-vitest-config\n");
		expectApiProject("/my-app", "api");
		expectApiProject("/my-app", "billing");

		const pkg = readJson("/my-app/package.json");
		expect(pkg.scripts?.start).toContain("projects/api");
		expect(pkg.scripts?.["start:billing"]).toContain("projects/billing");
		expect(pkg.scripts?.["package:billing"]).toContain("forge package @my-app/billing");
		expect(readFileSync("/my-app/projects/billing/Dockerfile", "utf8")).toContain(
			"COPY .package/ ./",
		);
	});

	it("refuses add when the API already exists", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...NON_INTERACTIVE]);
		const errors: string[] = [];
		vi.spyOn(console, "error").mockImplementation((msg?: unknown) => {
			errors.push(String(msg ?? ""));
		});

		const code = await runCliAsNodeBin(
			["add", "api", "api", "-d", "my-app", ...NON_INTERACTIVE],
			{
				resetFs: false,
			},
		);

		expect(code).toBe(1);
		expect(errors.join("\n")).toMatch(/already exists/);
	});

	it("refuses add outside a Decohere workspace", async () => {
		const errors: string[] = [];
		vi.spyOn(console, "error").mockImplementation((msg?: unknown) => {
			errors.push(String(msg ?? ""));
		});

		const code = await runCliAsNodeBin(["add", "api", "billing", ...NON_INTERACTIVE]);

		expect(code).toBe(1);
		expect(errors.join("\n")).toMatch(/Not a Decohere workspace/);
		expect(existsSync("/projects/billing")).toBe(false);
	});

	it("refuses an invalid --name", async () => {
		const errors: string[] = [];
		vi.spyOn(console, "error").mockImplementation((msg?: unknown) => {
			errors.push(String(msg ?? ""));
		});

		await runCliAsNodeBin([
			"create",
			"webapi",
			"my-app",
			"--name",
			"Billing",
			...NON_INTERACTIVE,
		]);

		expect(errors.join("\n")).toMatch(/Invalid API name/);
		expect(existsSync("/my-app/projects/Billing")).toBe(false);
	});
});

describe("auth0 login and configure", () => {
	it("exits when auth0 login runs without the Auth0 CLI", async () => {
		const errors: string[] = [];
		vi.spyOn(console, "error").mockImplementation((msg?: unknown) => {
			errors.push(String(msg ?? ""));
		});

		await runCliAsNodeBin(["auth0", "login"]);

		expect(errors.join("\n")).toMatch(/Auth0 CLI is required/);
		expect(existsSync("/package.json")).toBe(false);
	});

	it("prints the tenant after auth0 login", async () => {
		mockIsInstalled.mockReturnValue(true);
		mockListTenants.mockReturnValue([{ name: "dev-tenant.us.auth0.com", active: true }]);
		const logs: string[] = [];
		vi.spyOn(console, "log").mockImplementation((msg?: unknown) => {
			logs.push(String(msg ?? ""));
		});

		await runCliAsNodeBin(["auth0", "login"]);

		expect(mockLogin).toHaveBeenCalledOnce();
		expect(logs.join("\n")).toMatch(/Auth0 tenant: https:\/\/dev-tenant\.us\.auth0\.com/);
		expect(logs.join("\n")).toContain("auth0 configure");
		expect(existsSync("/package.json")).toBe(false);
	});

	it("updates Auth0 env without rewriting the app", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...NON_INTERACTIVE]);
		writeFileSync(
			"/my-app/.env",
			"AUTH0_ISSUER_BASE_URL=https://dev-tenant.us.auth0.com\nAUTH0_AUDIENCE=https://api.my-app\nKEEP=1\n",
		);
		writeFileSync(
			"/my-app/projects/api/src/controllers/hello.controller.ts",
			"// keep-controller\n",
		);
		mockIsInstalled.mockReturnValue(true);
		mockListTenants.mockReturnValue([{ name: "dev-tenant.us.auth0.com", active: true }]);

		await runCliAsNodeBin(["auth0", "configure", "-d", "my-app"], { resetFs: false });

		expect(mockUpdateApiScopes).toHaveBeenCalledWith("https://api.my-app", [
			"create:Hello",
			"delete:Hello",
			"read:Hello",
			"update:Hello",
		]);
		expect(
			readFileSync("/my-app/projects/api/src/controllers/hello.controller.ts", "utf8"),
		).toBe("// keep-controller\n");
		const env = readFileSync("/my-app/.env", "utf8");
		expect(env).toContain("AUTH0_ISSUER_BASE_URL=https://dev-tenant.us.auth0.com");
		expect(env).toContain("AUTH0_AUDIENCE=https://api.my-app");
		expect(env).toContain("KEEP=1");
		expect(env).toContain("AUTH0_CLIENT_ID=spa_123");
		expect(mockEnsureSpaApp).toHaveBeenCalledWith("my-app Dev", expect.any(Array));
		expect(mockAssignUserPermissions).not.toHaveBeenCalled();
	});

	it("stops, changing nothing, when logged in to a different tenant", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...NON_INTERACTIVE]);
		const env =
			"AUTH0_ISSUER_BASE_URL=https://client-a.us.auth0.com\nAUTH0_AUDIENCE=https://api.my-app\n";
		writeFileSync("/my-app/.env", env);
		mockIsInstalled.mockReturnValue(true);
		mockListTenants.mockReturnValue([{ name: "client-b.us.auth0.com", active: true }]);
		const errors: string[] = [];
		vi.spyOn(console, "error").mockImplementation((msg?: unknown) => {
			errors.push(String(msg ?? ""));
		});

		await runCliAsNodeBin(["auth0", "configure", "-d", "my-app"], { resetFs: false });

		expect(errors.join("\n")).toContain(
			"set up for Auth0 tenant https://client-a.us.auth0.com",
		);
		expect(mockUpdateApiScopes).not.toHaveBeenCalled();
		expect(mockEnsureSpaApp).not.toHaveBeenCalled();
		expect(mockEnsureM2mApp).not.toHaveBeenCalled();
		expect(readFileSync("/my-app/.env", "utf8")).toBe(env);
	});

	it("sets up a token app allowed the API's permissions", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...NON_INTERACTIVE]);
		writeFileSync("/my-app/.env", "AUTH0_AUDIENCE=https://api.my-app\n");
		mockIsInstalled.mockReturnValue(true);
		mockListTenants.mockReturnValue([{ name: "dev-tenant.us.auth0.com", active: true }]);

		await runCliAsNodeBin(["auth0", "configure", "-d", "my-app"], { resetFs: false });

		expect(mockEnsureM2mApp).toHaveBeenCalledWith("my-app Token");
		expect(mockEnsureClientGrant).toHaveBeenCalledWith("m2m_123", "https://api.my-app", [
			"create:Hello",
			"delete:Hello",
			"read:Hello",
			"update:Hello",
		]);
		expect(readFileSync("/my-app/.env", "utf8")).toContain("AUTH0_TOKEN_CLIENT_ID=m2m_123");
	});

	it("auth0 token prints only the token, with the API's permissions", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...NON_INTERACTIVE]);
		writeFileSync(
			"/my-app/.env",
			"AUTH0_AUDIENCE=https://api.my-app\nAUTH0_TOKEN_CLIENT_ID=m2m_123\n",
		);
		mockIsInstalled.mockReturnValue(true);
		mockListApiScopes.mockReturnValue(["read:Hello"]);
		const written: string[] = [];
		const write = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
			written.push(String(chunk));
			return true;
		});
		const logs = vi.spyOn(console, "log");

		await runCliAsNodeBin(["auth0", "token", "-d", "my-app"], { resetFs: false });

		write.mockRestore();
		expect(mockRequestAccessToken).toHaveBeenCalledWith("m2m_123", "https://api.my-app", [
			"read:Hello",
		]);
		expect(written.join("")).toBe("a-token\n");
		expect(logs).not.toHaveBeenCalled();
	});

	it("auth0 token says what to run when there's no token app", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...NON_INTERACTIVE]);
		writeFileSync("/my-app/.env", "AUTH0_AUDIENCE=https://api.my-app\n");
		mockIsInstalled.mockReturnValue(true);
		const errors: string[] = [];
		vi.spyOn(console, "error").mockImplementation((msg?: unknown) => {
			errors.push(String(msg ?? ""));
		});

		await runCliAsNodeBin(["auth0", "token", "-d", "my-app"], { resetFs: false });

		expect(errors.join("\n")).toContain("pnpm decohere auth0 configure");
		expect(mockRequestAccessToken).not.toHaveBeenCalled();
	});

	it("adds controller @Authorize scopes to the Auth0 API", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...NON_INTERACTIVE]);
		writeFileSync(
			"/my-app/.env",
			[
				"AUTH0_ISSUER_BASE_URL=https://dev-tenant.us.auth0.com",
				"AUTH0_AUDIENCE=https://api.my-app",
				"AUTH0_ADMIN_USER_SUB=auth0|admin",
				"",
			].join("\n"),
		);
		writeFileSync(
			"/my-app/projects/api/src/controllers/invoice.controller.ts",
			[
				'@Authorize("read", "Invoice")',
				"export class InvoiceController {",
				'	@Authorize("create", "Invoice")',
				"	public create() {}",
				"}",
				"",
			].join("\n"),
		);
		mockIsInstalled.mockReturnValue(true);
		mockListTenants.mockReturnValue([{ name: "dev-tenant.us.auth0.com", active: true }]);
		mockListApiScopes.mockReturnValue(["read:Hello"]);

		await runCliAsNodeBin(["auth0", "configure", "-d", "my-app"], { resetFs: false });

		expect(mockUpdateApiScopes).toHaveBeenCalledWith("https://api.my-app", [
			"create:Invoice",
			"read:Hello",
			"read:Invoice",
		]);
		expect(mockAssignUserPermissions).toHaveBeenCalledWith(
			"auth0|admin",
			"https://api.my-app",
			["create:Invoice", "read:Hello", "read:Invoice"],
		);
	});

	it("refuses configure outside a Decohere workspace", async () => {
		const errors: string[] = [];
		vi.spyOn(console, "error").mockImplementation((msg?: unknown) => {
			errors.push(String(msg ?? ""));
		});

		await runCliAsNodeBin(["auth0", "configure"]);

		expect(errors.join("\n")).toMatch(/Not a Decohere workspace/);
	});
});

const POSTGRES = [
	"--database",
	"postgres/typeorm",
	"--auth",
	"none",
	"--install",
	"no",
] as const;

describe("decohere add auth0", () => {
	const main = "/my-app/projects/api/src/main.ts";

	async function addAuth0(): Promise<number> {
		mockIsInstalled.mockReturnValue(true);
		mockListTenants.mockReturnValue([{ name: "dev-tenant.us.auth0.com", active: true }]);
		return runCliAsNodeBin(["add", "auth0", "-d", "my-app"], { resetFs: false });
	}

	it("sets up Auth0 and wires it into a project created without it", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...NON_INTERACTIVE]);
		expect(readFileSync(main, "utf8")).not.toContain("withAuth");

		expect(await addAuth0()).toBe(0);

		const source = readFileSync(main, "utf8");
		expect(source).toContain('import "@decohere/http/auth";');
		expect(source).toMatch(/\.withConfiguration\(YamlDataSource\)\n\s*\.withAuth\(\)/);
		expect(readFileSync("/my-app/config/config.yaml", "utf8")).toContain(
			"discoveryUrl: ${AUTH0_ISSUER_BASE_URL}",
		);
		const env = readFileSync("/my-app/.env", "utf8");
		expect(env).toContain("AUTH0_ISSUER_BASE_URL=https://dev-tenant.us.auth0.com");
		expect(env).toContain("AUTH0_AUDIENCE=");
		expect(env).toContain("AUTH0_CLIENT_ID=spa_123");
	});

	it("changes nothing when run again", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...NON_INTERACTIVE]);
		await addAuth0();
		const files = [main, "/my-app/config/config.yaml", "/my-app/.env"];
		const before = files.map((file) => readFileSync(file, "utf8"));

		expect(await addAuth0()).toBe(0);

		expect(files.map((file) => readFileSync(file, "utf8"))).toEqual(before);
	});

	it("leaves a main.ts it can't change safely and says what to add", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...NON_INTERACTIVE]);
		const custom = "export const app = buildMyOwnApp();\n";
		writeFileSync(main, custom);
		const logs: string[] = [];
		vi.spyOn(console, "log").mockImplementation((msg?: unknown) => {
			logs.push(String(msg ?? ""));
		});

		expect(await addAuth0()).toBe(0);

		expect(readFileSync(main, "utf8")).toBe(custom);
		expect(logs.join("\n")).toContain("projects/api/src/main.ts");
		expect(logs.join("\n")).toContain('import "@decohere/http/auth";');
	});

	it("refuses outside a Decohere workspace", async () => {
		const errors: string[] = [];
		vi.spyOn(console, "error").mockImplementation((msg?: unknown) => {
			errors.push(String(msg ?? ""));
		});

		await runCliAsNodeBin(["add", "auth0"]);

		expect(errors.join("\n")).toMatch(/Not a Decohere workspace/);
	});
});

describe("scaffolder options that no longer exist", () => {
	it("rejects --postman with an unknown option error and writes nothing", async () => {
		const stderr: string[] = [];
		vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
			stderr.push(String(chunk));
			return true;
		});

		const code = await runCliAsNodeBin(["create", "webapi", "my-app", "--postman", "none"]);

		expect(code).not.toBe(0);
		expect(stderr.join("")).toContain("unknown option '--postman'");
		expect(existsSync("/my-app/package.json")).toBe(false);
	});
});

describe("scaffolder writes a root README with CLI examples", () => {
	it("includes webapi add and pnpm dev, and omits db:* when database is none", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...NON_INTERACTIVE]);

		const readme = readFileSync("/my-app/README.md", "utf8");
		expect(readme).toContain("decohere add api <name>");
		expect(readme).toContain("pnpm dev");
		expect(readme).toContain("pnpm install");
		expect(readme).toContain("Reopen in Container");
		expect(readme).not.toContain("y/N");
		expect(readme).not.toContain("RAG");
		expect(readme).toContain("http://localhost:3000/openapi.json");
		expect(readme).toContain("forge package");
		expect(readme).toContain("## Logging");
		expect(readme).toContain("NODE_ENV=production");
		expect(readme).not.toContain("pnpm db:up");
		expect(readme).not.toContain("## Auth0");
		expect(readme).toContain("decohere add auth0");
	});

	it("includes db:up when postgres is enabled", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...POSTGRES]);

		const readme = readFileSync("/my-app/README.md", "utf8");
		expect(readme).toContain("pnpm db:up");
		expect(readme).toContain("pnpm db:down");
		expect(readme).toContain("pnpm db:reset");
		expect(readme).toContain("decohere add api <name>");
		expect(readme).toContain("pnpm dev");
	});

	it("refreshes API scripts when webapi add runs", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...NON_INTERACTIVE]);
		await runCliAsNodeBin(["add", "api", "billing", "-d", "my-app", ...NON_INTERACTIVE], {
			resetFs: false,
		});

		const readme = readFileSync("/my-app/README.md", "utf8");
		expect(readme).toContain("pnpm run start:api");
		expect(readme).toContain("pnpm run start:billing");
		expect(readme).toContain("pnpm run dev:billing");
		expect(readme).toContain("decohere add api <name>");
	});

	it("keeps db:* after webapi add when the workspace already has postgres", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...POSTGRES]);
		await runCliAsNodeBin(["add", "api", "billing", "-d", "my-app", ...NON_INTERACTIVE], {
			resetFs: false,
		});

		const readme = readFileSync("/my-app/README.md", "utf8");
		expect(readme).toContain("pnpm db:up");
		expect(readme).toContain("pnpm run start:billing");
	});
});

describe("each API owns a database on the shared Postgres instance", () => {
	it("names the default API datasource and prefixes env", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...POSTGRES]);

		const config = readFileSync("/my-app/config/config.yaml", "utf8");
		expect(config).toContain("name: api");
		expect(config).toContain("${API_DB_HOST}");
		expect(config).not.toContain("name: default");
		expect(config).not.toContain("${DB_HOST}");

		const env = readFileSync("/my-app/.env", "utf8");
		expect(env).toContain("API_DB_HOST=postgres");
		expect(env).toContain("API_DB_PORT=5432");
		expect(env).toMatch(/API_DB_NAME=/);
		expect(env).not.toMatch(/^DB_NAME=/m);
		expect(env).not.toContain("PASSWORD");

		const main = readFileSync("/my-app/projects/api/src/main.ts", "utf8");
		expect(main).toContain("withHealth()");
		expect(main).toContain('withTypeOrm({ name: "api"');

		const compose = readFileSync("/my-app/.devcontainer/docker-compose.yml", "utf8");
		expect(compose).toContain("samples-my-app-postgres");
		expect(compose).toContain("./postgres-data:/var/lib/postgresql/data");
		expect(compose).toMatch(/bind mount|dies with the working tree/i);
		expect(compose).not.toContain("postgres-init");
		expect(compose).not.toMatch(/^\s+my-app-postgres-data:\s*$/m);
		expect(compose).not.toContain("adminer");

		const gitignore = readFileSync("/my-app/.gitignore", "utf8");
		expect(gitignore).toContain(".devcontainer/postgres-data");

		const rootPkg = JSON.parse(readFileSync("/my-app/package.json", "utf8")) as {
			scripts: Record<string, string>;
			dependencies: Record<string, string>;
		};
		expect(rootPkg.scripts["db:reset"]).toContain("rm -rf .devcontainer/postgres-data");
		expect(rootPkg.scripts["db:reset"]).not.toContain("down -v");
		// Stops the server before deleting its files, and sets the folder up again as you.
		const reset = rootPkg.scripts["db:reset"] ?? "";
		expect(reset.indexOf(" down")).toBeLessThan(reset.indexOf("rm -rf"));
		expect(reset.indexOf("rm -rf")).toBeLessThan(reset.indexOf("initialize.sh"));
		expect(reset.indexOf("initialize.sh")).toBeLessThan(reset.indexOf("up -d"));
		expect(rootPkg.scripts["db:up"]).toMatch(/initialize\.sh.*up -d postgres/);

		// Postgres runs as you, so you can delete its files without sudo.
		expect(compose).toContain('user: "${DECOHERE_UID:-1000}:${DECOHERE_GID:-1000}"');
		const initialize = readFileSync("/my-app/.devcontainer/initialize.sh", "utf8");
		expect(initialize).toContain('mkdir -p "$root/.devcontainer/postgres-data"');
		expect(initialize).toContain("DECOHERE_UID=");
		expect(gitignore).toContain(".env");

		expect(compose).toContain("image: postgres:16");
		expect(compose).toContain("POSTGRES_HOST_AUTH_METHOD: trust");
		expect(compose).toContain("127.0.0.1:5433:5432");
		expect(existsSync("/my-app/.devcontainer/postgres")).toBe(false);

		const appDevDockerfile = readFileSync("/my-app/.devcontainer/Dockerfile", "utf8");
		expect(appDevDockerfile).toContain("postgresql-client");
		expect(appDevDockerfile).toContain("USER root");
		expect(appDevDockerfile).toMatch(/^FROM ghcr\.io\/typesmiths\/decohere\/devcontainer:/m);
		const devcontainerJson = readFileSync("/my-app/.devcontainer/devcontainer.json", "utf8");
		expect(devcontainerJson).toContain("mtxr.sqltools-driver-pg");

		const depKeys = Object.keys(rootPkg.dependencies);
		expect(depKeys).toEqual([...depKeys].sort((a, b) => a.localeCompare(b, "en")));
		expect(rootPkg.dependencies.tsx).toBeTruthy();
		expect(rootPkg.scripts["db:migrate"]).toContain("migration:run");
		expect(rootPkg.scripts["db:migrate"]).toContain("typeorm.data-source.ts");
		expect(rootPkg.scripts["db:migrate:generate"]).toContain("migration:generate");
		expect(rootPkg.scripts["db:migrate:api"]).toContain("projects/api");

		expect(existsSync("/my-app/docs/database.md")).toBe(true);
		const dbDocs = readFileSync("/my-app/docs/database.md", "utf8");
		expect(dbDocs).toMatch(/synchronize: true/);
		expect(dbDocs).toMatch(/migrations only/i);
		expect(dbDocs).toContain("db:migrate");
		expect(dbDocs).toMatch(/Adminer is \*\*not\*\* scaffolded/i);
		expect(dbDocs).toContain("image: adminer");

		expect(existsSync("/my-app/projects/api/src/typeorm.data-source.ts")).toBe(true);
		const dataSource = readFileSync("/my-app/projects/api/src/typeorm.data-source.ts", "utf8");
		expect(dataSource).toContain("API_DB_MIGRATE_USER");
		expect(dataSource).toContain("synchronize: false");
		expect(existsSync("/my-app/projects/api/src/migrations/.gitkeep")).toBe(true);
	});

	it("emits per-API migrate scripts and data sources for named APIs", async () => {
		await runCliAsNodeBin([
			"create",
			"webapi",
			"my-app",
			"--name",
			"api",
			"--name",
			"billing",
			...POSTGRES,
		]);

		const pkg = JSON.parse(readFileSync("/my-app/package.json", "utf8")) as {
			scripts: Record<string, string>;
		};
		expect(pkg.scripts["db:migrate:billing"]).toContain("projects/billing");
		expect(pkg.scripts["db:migrate:generate:billing"]).toContain("migration:generate");
		expect(existsSync("/my-app/projects/billing/src/typeorm.data-source.ts")).toBe(true);
		expect(
			readFileSync("/my-app/projects/billing/src/typeorm.data-source.ts", "utf8"),
		).toContain("BILLING_DB_MIGRATE_USER");
	});

	it("gives each named API its own database on the same host", async () => {
		await runCliAsNodeBin([
			"create",
			"webapi",
			"my-app",
			"--name",
			"api",
			"--name",
			"billing",
			...POSTGRES,
		]);

		const config = readFileSync("/my-app/config/config.yaml", "utf8");
		expect(config).toContain("name: api");
		expect(config).toContain("name: billing");
		expect(config).toContain("${BILLING_DB_HOST}");

		const env = readFileSync("/my-app/.env", "utf8");
		expect(env).toContain("API_DB_HOST=postgres");
		expect(env).toContain("BILLING_DB_HOST=postgres");
		const apiDb = env.split("\n").find((l) => l.startsWith("API_DB_NAME="));
		const billingDb = env.split("\n").find((l) => l.startsWith("BILLING_DB_NAME="));
		expect(apiDb).toBeTruthy();
		expect(billingDb).toBeTruthy();
		expect(apiDb).not.toBe(billingDb);

		expect(readFileSync("/my-app/projects/api/src/main.ts", "utf8")).toContain(
			'withTypeOrm({ name: "api"',
		);
		expect(readFileSync("/my-app/projects/billing/src/main.ts", "utf8")).toContain(
			'withTypeOrm({ name: "billing"',
		);

		const compose = readFileSync("/my-app/.devcontainer/docker-compose.yml", "utf8");
		expect(compose).toContain("container_name: samples-my-app-postgres");
		expect(compose).not.toContain("samples-my-app-billing-postgres");
	});

	it("adds Postgres to a workspace created without a database", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...NON_INTERACTIVE]);
		const composePath = "/my-app/.devcontainer/docker-compose.yml";
		writeFileSync(composePath, `# my own note\n${readFileSync(composePath, "utf8")}`);
		writeFileSync(
			"/my-app/.gitignore",
			`${readFileSync("/my-app/.gitignore", "utf8")}coverage\n`,
		);

		await runCliAsNodeBin(["add", "api", "billing", "-d", "my-app", ...POSTGRES], {
			resetFs: false,
		});

		const compose = readFileSync(composePath, "utf8");
		expect(compose).toContain("# my own note");
		expect(compose).toContain("container_name: samples-my-app-postgres");
		expect(compose).toContain("../.env");
		expect(compose).toMatch(/^ {2}devcontainer:/m);
		expect(compose).toContain("POSTGRES_HOST_AUTH_METHOD: trust");

		const gitignore = readFileSync("/my-app/.gitignore", "utf8");
		expect(gitignore).toContain("coverage");
		expect(gitignore).toContain(".devcontainer/postgres-data");

		const devcontainer = JSON.parse(
			readFileSync("/my-app/.devcontainer/devcontainer.json", "utf8"),
		) as {
			forwardPorts: number[];
			portsAttributes: Record<string, { label?: string }>;
			customizations: { vscode: { extensions: string[] } };
			initializeCommand?: string;
		};
		expect(devcontainer.forwardPorts).toEqual([3000, 3001]);
		expect(devcontainer.portsAttributes["3001"]?.label).toBe("billing");
		expect(devcontainer.customizations.vscode.extensions).toContain("mtxr.sqltools");
		expect(devcontainer.customizations.vscode.extensions).toContain("biomejs.biome");
		expect(devcontainer.initializeCommand).toBeDefined();

		expect(readFileSync("/my-app/.devcontainer/Dockerfile", "utf8")).toContain(
			"postgresql-client",
		);
		expect(readJson("/my-app/package.json").scripts?.["db:up"]).toBeDefined();
	});

	it("forwards the new API's port when adding without a database", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...NON_INTERACTIVE]);
		await runCliAsNodeBin(["add", "api", "billing", "-d", "my-app", ...NON_INTERACTIVE], {
			resetFs: false,
		});

		const devcontainer = JSON.parse(
			readFileSync("/my-app/.devcontainer/devcontainer.json", "utf8"),
		) as { forwardPorts: number[] };
		expect(devcontainer.forwardPorts).toEqual([3000, 3001]);
		expect(readFileSync("/my-app/.devcontainer/docker-compose.yml", "utf8")).not.toContain(
			"postgres",
		);
	});

	it("adding a second database API leaves the existing compose services alone", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...POSTGRES]);
		const before = readFileSync("/my-app/.devcontainer/docker-compose.yml", "utf8");
		await runCliAsNodeBin(["add", "api", "billing", "-d", "my-app", ...POSTGRES], {
			resetFs: false,
		});
		const after = readFileSync("/my-app/.devcontainer/docker-compose.yml", "utf8");
		expect(after.match(/container_name: samples-my-app-postgres/g)?.length).toBe(1);
		expect(after.match(/\.\.\/\.env/g)?.length).toBe(before.match(/\.\.\/\.env/g)?.length);
	});

	it("adds a datasource for webapi add without replacing the first", async () => {
		await runCliAsNodeBin(["create", "webapi", "my-app", ...POSTGRES]);
		await runCliAsNodeBin(["add", "api", "billing", "-d", "my-app", ...POSTGRES], {
			resetFs: false,
		});

		const config = readFileSync("/my-app/config/config.yaml", "utf8");
		expect(config).toContain("name: api");
		expect(config).toContain("name: billing");
		expect(config.match(/^database:/gm)?.length).toBe(1);

		const env = readFileSync("/my-app/.env", "utf8");
		expect(env).toContain("API_DB_HOST=postgres");
		expect(env).toContain("BILLING_DB_HOST=postgres");
		expect(readFileSync("/my-app/projects/billing/src/main.ts", "utf8")).toContain(
			'withTypeOrm({ name: "billing"',
		);

		const pkg = JSON.parse(readFileSync("/my-app/package.json", "utf8")) as {
			scripts: Record<string, string>;
		};
		expect(pkg.scripts["db:migrate"]).toContain("projects/api");
		expect(pkg.scripts["db:migrate:billing"]).toContain("projects/billing");
		expect(existsSync("/my-app/projects/billing/src/typeorm.data-source.ts")).toBe(true);
	});
});
