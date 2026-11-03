import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockExecFileSync, mockSpawnSync, mockMkdirSync, mockExistsSync } = vi.hoisted(() => ({
	mockExecFileSync: vi.fn(),
	mockSpawnSync: vi.fn(),
	mockMkdirSync: vi.fn(),
	mockExistsSync: vi.fn().mockReturnValue(false),
}));

vi.mock("node:child_process", () => ({
	execFileSync: mockExecFileSync,
	spawnSync: mockSpawnSync,
}));

vi.mock("node:fs", () => ({
	mkdirSync: mockMkdirSync,
	existsSync: mockExistsSync,
}));

vi.mock(
	import("../src/version.js"),
	() =>
		({
			CREATE_VERSION: "0.0.1-test",
			CREATE_IMAGE_REPOSITORY: "ghcr.io/typesmiths/decohere/create",
		}) as const,
);

const { runInBuilder } = await import("../src/runner.js");
const { containerArgvFromHost, resolveLaunch } = await import("../src/resolve-launch.js");

const IMAGE = "ghcr.io/typesmiths/decohere/create:0.0.1-test";

let exitCode: number | undefined;
vi.spyOn(process, "exit").mockImplementation((code?: number | string) => {
	exitCode = typeof code === "number" ? code : 0;
	throw new Error(`process.exit(${exitCode})`);
});

function run(argv: string[]): void {
	try {
		runInBuilder(argv);
	} catch {
		// process.exit throws in tests — expected.
	}
}

function getRunArgs(): string[] {
	const runCall = mockSpawnSync.mock.calls.find(
		(c) => c[0] === "docker" && c[1].includes("run"),
	);
	expect(runCall).toBeDefined();
	if (runCall == null) {
		throw new Error("Expected docker run to be called");
	}
	return runCall[1];
}

beforeEach(() => {
	exitCode = undefined;
	mockExecFileSync.mockReset();
	mockSpawnSync.mockReset();
	mockMkdirSync.mockReset();
	mockExistsSync.mockReset();
	mockExecFileSync.mockReturnValue(Buffer.from(""));
	mockSpawnSync.mockReturnValue({ status: 0 });
	mockExistsSync.mockReturnValue(false);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("resolveLaunch", () => {
	it("forwards --help without rewriting to webapi -d .", () => {
		const plan = resolveLaunch(["--help"], "/cwd");
		expect(plan.containerArgv).toEqual(["--help"]);
		expect(plan.targetDir).toBe("/cwd");
	});

	it("maps npm create webapi directory onto create webapi -d .", () => {
		const plan = resolveLaunch(["webapi", "crypto"], "/cwd");
		expect(plan.targetDir).toBe("/cwd/crypto");
		expect(plan.projectName).toBe("crypto");
		expect(plan.containerArgv).toEqual(["create", "webapi", "-d", "."]);
	});

	it("forwards decohere create webapi after dropping the host directory", () => {
		const plan = resolveLaunch(["create", "webapi", "-d", "my-app"], "/cwd");
		expect(plan.targetDir).toBe("/cwd/my-app");
		expect(plan.containerArgv).toEqual(["create", "webapi", "-d", "."]);
	});

	it("forwards flags after dropping the host directory", () => {
		const plan = resolveLaunch(
			["webapi", "my-app", "--auth", "auth0", "--database", "postgres/typeorm"],
			"/cwd",
		);
		expect(plan.targetDir).toBe("/cwd/my-app");
		expect(plan.containerArgv).toEqual([
			"create",
			"webapi",
			"--auth",
			"auth0",
			"--database",
			"postgres/typeorm",
			"-d",
			".",
		]);
	});

	it("maps npm webapi add onto add api without treating the name as a directory", () => {
		const plan = resolveLaunch(["webapi", "add", "billing"], "/cwd");
		expect(plan.targetDir).toBe("/cwd");
		expect(plan.containerArgv).toEqual(["add", "api", "billing", "-d", "."]);
	});

	it("forwards auth0 login without wrapping as create webapi", () => {
		const plan = resolveLaunch(["auth0", "login"], "/cwd");
		expect(plan.targetDir).toBe("/cwd");
		expect(plan.kind).toBe("auth0");
		expect(plan.containerArgv).toEqual(["auth0", "login", "-d", "."]);
	});

	it("forwards auth0 configure -d onto the mounted workspace", () => {
		const plan = resolveLaunch(["auth0", "configure", "-d", "my-app"], "/cwd");
		expect(plan.targetDir).toBe("/cwd/my-app");
		expect(plan.kind).toBe("auth0");
		expect(plan.containerArgv).toEqual(["auth0", "configure", "-d", "."]);
	});
});

describe("containerArgvFromHost", () => {
	it("strips host --log-level / --config-file and prepends create for npm webapi", () => {
		expect(
			containerArgvFromHost([
				"/usr/bin/node",
				"/path/to/cli.js",
				"--log-level",
				"debug",
				"create",
				"webapi",
				"-d",
				"my-app",
			]),
		).toEqual(["create", "webapi", "-d", "my-app"]);
		expect(containerArgvFromHost(["webapi", "-d", "my-app"])).toEqual([
			"create",
			"webapi",
			"-d",
			"my-app",
		]);
	});
});

describe("runInBuilder", () => {
	it("creates the target directory", () => {
		run(["webapi", "-d", "/tmp/my-project"]);
		expect(mockMkdirSync).toHaveBeenCalledWith("/tmp/my-project", { recursive: true });
		expect(mockMkdirSync).toHaveBeenCalledWith("/tmp/my-project/.devcontainer/npm-auth", {
			recursive: true,
		});
	});

	it("checks docker availability via docker info", () => {
		run(["webapi", "-d", "/tmp/my-project"]);
		expect(mockExecFileSync).toHaveBeenCalledWith("docker", ["info"], { stdio: "pipe" });
	});

	it("exits with code 1 if docker is not available", () => {
		mockExecFileSync.mockImplementation(() => {
			throw new Error("docker not found");
		});
		expect(() => runInBuilder(["webapi", "-d", "/tmp/my-project"])).toThrow("process.exit(1)");
		expect(exitCode).toBe(1);
	});

	it("runs docker with correct image, env var, and working directory", () => {
		run(["webapi", "-d", "/tmp/my-project"]);

		const args = getRunArgs();
		expect(args).toContain("--rm");
		expect(args.some((a) => a === "-i" || a === "-it")).toBe(true);
		expect(args).toContain("DECOHERE_BUILDER=1");
		expect(args).toContain("/workspace");
		expect(args).toContain(IMAGE);
		expect(args).toContain("create");
		expect(args).toContain("webapi");
		expect(args).not.toContain("decohere");
	});

	it("mounts the target directory as /workspace", () => {
		run(["webapi", "-d", "/tmp/my-project"]);

		const args = getRunArgs();
		const vIdx = args.indexOf("-v");
		expect(vIdx).toBeGreaterThan(-1);
		expect(args[vIdx + 1]).toBe("/tmp/my-project:/workspace");
	});

	it("mounts a host-writable npm cache (not an anonymous root volume)", () => {
		run(["webapi", "-d", "/tmp/my-project"]);

		const args = getRunArgs();
		const cacheMount = args.find(
			(a) => typeof a === "string" && a.includes("decohere-create/npm:/npm-cache"),
		);
		expect(cacheMount).toBeDefined();
	});

	it("sets npm cache env vars for faster repeated installs", () => {
		run(["webapi", "-d", "/tmp/my-project"]);

		const args = getRunArgs();
		expect(args).toContain("NPM_CONFIG_CACHE=/npm-cache");
		expect(args).toContain("NPM_CONFIG_PREFER_OFFLINE=true");
	});

	it("runs the builder as the host uid/gid so files are never root-owned", () => {
		run(["webapi", "-d", "/tmp/my-project"]);

		const args = getRunArgs();
		const uid = process.getuid?.();
		const gid = process.getgid?.();
		if (uid != null && gid != null) {
			expect(args).toContain("--user");
			expect(args).toContain(`${uid}:${gid}`);
			expect(args).not.toContain(`HOST_UID=${uid}`);
		}
	});

	it("passes the host directory basename as DECOHERE_PROJECT_NAME", () => {
		run(["webapi", "-d", "/data/das974/test1"]);

		const args = getRunArgs();
		expect(args).toContain("DECOHERE_PROJECT_NAME=test1");
	});

	it("mounts host .npmrc when present for private registry credentials", () => {
		mockExistsSync.mockImplementation((p: string) => String(p).endsWith("/.npmrc"));

		run(["webapi", "-d", "/tmp/my-project"]);

		const args = getRunArgs();
		const mountIdx = args.findIndex(
			(a) => typeof a === "string" && a.endsWith("/.npmrc:/tmp/host-npmrc:ro"),
		);
		expect(mountIdx).toBeGreaterThan(-1);
		expect(args).toContain("NPM_CONFIG_USERCONFIG=/tmp/host-npmrc");
	});

	it("does not mount .npmrc when absent", () => {
		mockExistsSync.mockReturnValue(false);

		run(["webapi", "-d", "/tmp/my-project"]);

		const args = getRunArgs();
		expect(args.some((a) => typeof a === "string" && a.includes("host-npmrc"))).toBe(false);
	});

	it("always creates and mounts host ~/.config/auth0 into builder HOME", () => {
		run(["webapi", "-d", "/tmp/my-project"]);

		const args = getRunArgs();
		const mount = args.find(
			(a) =>
				typeof a === "string" &&
				a.includes(".config/auth0") &&
				a.includes("/tmp/decohere-create-home/.config/auth0"),
		);
		expect(mount).toBeDefined();
		expect(mockMkdirSync).toHaveBeenCalledWith(expect.stringContaining(".config/auth0"), {
			recursive: true,
		});
	});

	it("does not create .devcontainer for auth0 login", () => {
		run(["auth0", "login"]);

		expect(
			mockMkdirSync.mock.calls.some(
				(c) => typeof c[0] === "string" && String(c[0]).includes(".devcontainer"),
			),
		).toBe(false);
		expect(getRunArgs()).toEqual(expect.arrayContaining(["auth0", "login"]));
	});

	it("does not print scaffold-complete after auth0 login", () => {
		const logs: string[] = [];
		vi.spyOn(console, "log").mockImplementation((msg?: unknown) => {
			logs.push(String(msg ?? ""));
		});
		run(["auth0", "login"]);
		expect(logs.join("\n")).toContain("Running Auth0 CLI");
		expect(logs.join("\n")).not.toContain("Scaffold complete");
	});

	it("forwards predefined scaffold options into the container command", () => {
		run([
			"webapi",
			"-d",
			"/tmp/my-project",
			"--database",
			"postgres/typeorm",
			"--auth",
			"auth0",
			"--postman",
			"local",
			"--install",
			"no",
		]);

		const args = getRunArgs();
		expect(args).toEqual(
			expect.arrayContaining([
				"create",
				"webapi",
				"--database",
				"postgres/typeorm",
				"--auth",
				"auth0",
				"--postman",
				"local",
				"--install",
				"no",
				"-d",
				".",
			]),
		);
	});

	it("forwards --name into the container command", () => {
		run(["webapi", "-d", "/tmp/my-project", "--name", "billing", "--name", "admin"]);

		const args = getRunArgs();
		expect(args).toEqual(
			expect.arrayContaining([
				"create",
				"webapi",
				"--name",
				"billing",
				"--name",
				"admin",
				"-d",
				".",
			]),
		);
	});

	it("forwards webapi add into the container as add api", () => {
		run(["webapi", "add", "billing"]);

		const args = getRunArgs();
		expect(args).toEqual(expect.arrayContaining(["add", "api", "billing", "-d", "."]));
		expect(args).not.toContain("--name");
	});

	it("forwards decohere add api into the container as-is", () => {
		run(["add", "api", "billing"]);

		const args = getRunArgs();
		expect(args).toEqual(expect.arrayContaining(["add", "api", "billing", "-d", "."]));
	});

	it("defaults to current directory when -d is not provided", () => {
		const cwd = process.cwd();
		run(["webapi"]);
		expect(mockMkdirSync).toHaveBeenCalledWith(cwd, { recursive: true });
	});

	it("propagates the container exit code", () => {
		mockSpawnSync.mockReturnValueOnce({ status: 42 });
		expect(() => runInBuilder(["webapi", "-d", "/tmp/my-project"])).toThrow(
			"process.exit(42)",
		);
		expect(exitCode).toBe(42);
	});

	it("exits 0 when container exits successfully", () => {
		mockSpawnSync.mockReturnValueOnce({ status: 0 });
		expect(() => runInBuilder(["webapi", "-d", "/tmp/my-project"])).toThrow("process.exit(0)");
		expect(exitCode).toBe(0);
	});
});
