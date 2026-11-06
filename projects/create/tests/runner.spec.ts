import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	execFileSync: vi.fn(),
	spawn: vi.fn(),
	spawnSync: vi.fn(),
	existsSync: vi.fn(),
	mkdirSync: vi.fn(),
	mkdtempSync: vi.fn(),
	readdirSync: vi.fn(),
	readFileSync: vi.fn(),
	renameSync: vi.fn(),
	rmSync: vi.fn(),
	writeFileSync: vi.fn(),
	chmodSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({
	execFileSync: mocks.execFileSync,
	spawn: mocks.spawn,
	spawnSync: mocks.spawnSync,
}));

vi.mock("node:fs", () => ({
	existsSync: mocks.existsSync,
	mkdirSync: mocks.mkdirSync,
	mkdtempSync: mocks.mkdtempSync,
	readdirSync: mocks.readdirSync,
	readFileSync: mocks.readFileSync,
	renameSync: mocks.renameSync,
	rmSync: mocks.rmSync,
	writeFileSync: mocks.writeFileSync,
	chmodSync: mocks.chmodSync,
}));

vi.mock(
	import("../src/version.js"),
	() =>
		({
			CREATE_VERSION: "0.0.1-test",
			CREATE_IMAGE_REPOSITORY: "ghcr.io/typesmiths/decohere/create",
		}) as const,
);

const { launch } = await import("../src/runner.js");
const { containerArgvFromHost, resolveLaunch } = await import("../src/resolve-launch.js");

const IMAGE = "ghcr.io/typesmiths/decohere/create:0.0.1-test";

let exitCode: number | undefined;

async function run(argv: string[]): Promise<void> {
	try {
		await launch(argv);
	} catch (reason) {
		// process.exit throws in tests; anything else is a real failure.
		if (!String(reason).includes("process.exit(")) throw reason;
	}
}

/** The container's exit code, as `docker start --attach` reports it. */
let containerExit = 0;

/** Captured so a test's handlers never stay on the real process. */
const signalHandlers = new Map<string, () => void>();

function dockerCalls(command: string): string[][] {
	return mocks.spawnSync.mock.calls
		.filter((c) => c[0] === "docker" && c[1][0] === command)
		.map((c) => c[1] as string[]);
}

function createArgs(): string[] {
	const [args] = dockerCalls("create");
	if (args == null) throw new Error("Expected docker create to be called");
	return args;
}

function containerName(): string {
	const args = createArgs();
	return args[args.indexOf("--name") + 1]!;
}

const spyOutput = (method: "log" | "error") => {
	const lines: string[] = [];
	vi.spyOn(console, method).mockImplementation((msg?: unknown) => {
		lines.push(String(msg ?? ""));
	});
	return lines;
};

beforeEach(() => {
	exitCode = undefined;
	containerExit = 0;
	vi.spyOn(process, "exit").mockImplementation((code?: number | string) => {
		exitCode = typeof code === "number" ? code : 0;
		throw new Error(`process.exit(${exitCode})`);
	});
	for (const mock of Object.values(mocks)) mock.mockReset();
	mocks.execFileSync.mockReturnValue(Buffer.from(""));
	mocks.spawnSync.mockReturnValue({ status: 0 });
	mocks.spawn.mockImplementation(() => {
		const child = new EventEmitter();
		queueMicrotask(() => child.emit("close", containerExit));
		return child;
	});
	mocks.existsSync.mockReturnValue(false);
	mocks.readdirSync.mockReturnValue([]);
	mocks.mkdtempSync.mockReturnValue("/target/.decohere-create-temp");
	signalHandlers.clear();
	vi.spyOn(process, "once").mockImplementation(((signal: string, handler: () => void) => {
		signalHandlers.set(signal, handler);
		return process;
	}) as typeof process.once);
	vi.stubEnv("DECOHERE_TOOLS", "");
	vi.stubEnv("REMOTE_CONTAINERS", "");
	vi.stubEnv("CODESPACES", "");
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
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
		expect(plan.kind).toBe("project");
		expect(plan.containerArgv).toEqual(["auth0", "login", "-d", "."]);
	});

	it("forwards auth0 configure -d onto the mounted workspace", () => {
		const plan = resolveLaunch(["auth0", "configure", "-d", "my-app"], "/cwd");
		expect(plan.targetDir).toBe("/cwd/my-app");
		expect(plan.kind).toBe("project");
		expect(plan.containerArgv).toEqual(["auth0", "configure", "-d", "."]);
	});
});

describe("resolveLaunch with a bare project name", () => {
	it("scaffolds a web API into that folder", () => {
		const plan = resolveLaunch(["my-app"], "/cwd");
		expect(plan.targetDir).toBe("/cwd/my-app");
		expect(plan.projectName).toBe("my-app");
		expect(plan.kind).toBe("create");
		expect(plan.containerArgv).toEqual(["create", "webapi", "-d", "."]);
	});

	it("keeps the flags that follow the name", () => {
		const plan = resolveLaunch(["my-app", "--auth", "none", "-y"], "/cwd");
		expect(plan.targetDir).toBe("/cwd/my-app");
		expect(plan.containerArgv).toEqual([
			"create",
			"webapi",
			"--auth",
			"none",
			"-y",
			"-d",
			".",
		]);
	});

	it.each([["create", "webapi"], ["add", "api", "billing"], ["auth0", "login"], ["help"]])(
		"leaves the command %s as it is",
		(...command) => {
			const plan = resolveLaunch(command, "/cwd");
			expect(plan.targetDir).toBe("/cwd");
			expect(plan.containerArgv).toEqual([...command, "-d", "."]);
		},
	);

	it("leaves a leading flag alone", () => {
		const plan = resolveLaunch(["--version", "extra"], "/cwd");
		expect(plan.targetDir).toBe("/cwd");
		expect(plan.containerArgv).toEqual(["--version", "extra", "-d", "."]);
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

describe("launch outside the tools", () => {
	it("checks that Docker is available", async () => {
		await run(["webapi", "-d", "/tmp/my-project"]);
		expect(mocks.execFileSync).toHaveBeenCalledWith("docker", ["info"], { stdio: "pipe" });
	});

	it("exits 1 and starts nothing when Docker isn't available", async () => {
		mocks.execFileSync.mockImplementation(() => {
			throw new Error("docker not found");
		});
		const errors = spyOutput("error");

		await run(["webapi", "-d", "/tmp/my-project"]);

		expect(exitCode).toBe(1);
		expect(errors.join("\n")).toContain("Install Docker Desktop");
		expect(mocks.spawnSync).not.toHaveBeenCalled();
	});

	it("doesn't suggest Docker Desktop inside a container with no Docker", async () => {
		vi.stubEnv("REMOTE_CONTAINERS", "true");
		mocks.execFileSync.mockImplementation(() => {
			throw new Error("docker not found");
		});
		const errors = spyOutput("error");

		await run(["webapi", "-d", "/tmp/my-project"]);

		expect(errors.join("\n")).toContain("can't reach it");
		expect(errors.join("\n")).not.toContain("Docker Desktop");
	});

	it("shares nothing from this machine with the container", async () => {
		await run(["webapi", "-d", "/tmp/my-project"]);

		const args = createArgs();
		for (const flag of ["-v", "--volume", "--mount", "--user"]) {
			expect(args).not.toContain(flag);
		}
		expect(args.join(" ")).not.toMatch(/npmrc|\.config\/auth0|npm-cache/);
	});

	it("creates the container from the pinned image, working in /workspace", async () => {
		await run(["webapi", "-d", "/tmp/my-project"]);

		const args = createArgs();
		expect(args).toContain(IMAGE);
		expect(args[args.indexOf("--workdir") + 1]).toBe("/workspace");
		expect(args).toContain("DECOHERE_BUILDER=1");
		expect(args).toContain("DECOHERE_PROJECT_NAME=my-project");
	});

	it("forwards scaffold options to the container", async () => {
		await run([
			"webapi",
			"-d",
			"/tmp/my-project",
			"--database",
			"postgres/typeorm",
			"--name",
			"billing",
		]);

		expect(createArgs()).toEqual(
			expect.arrayContaining([
				"create",
				"webapi",
				"--database",
				"postgres/typeorm",
				"--name",
				"billing",
				"-d",
				".",
			]),
		);
	});

	it("copies the project out through a temporary folder, then removes the container", async () => {
		mocks.readdirSync.mockImplementation((dir: string) =>
			dir.includes(".decohere-create-") ? ["package.json", ".env"] : [],
		);
		const logs = spyOutput("log");

		await run(["webapi", "-d", "/tmp/my-project"]);

		const name = containerName();
		expect(dockerCalls("cp")).toEqual([
			["cp", `${name}:/workspace/.`, "/target/.decohere-create-temp"],
		]);
		expect(mocks.renameSync).toHaveBeenCalledWith(
			"/target/.decohere-create-temp/package.json",
			"/tmp/my-project/package.json",
		);
		expect(mocks.renameSync).toHaveBeenCalledWith(
			"/target/.decohere-create-temp/.env",
			"/tmp/my-project/.env",
		);
		expect(dockerCalls("rm")).toEqual([["rm", "-f", name]]);
		expect(exitCode).toBe(0);
		expect(logs.join("\n")).toContain("Scaffold complete");
	});

	it("suggests opening the Dev Container only outside a container", async () => {
		const onHost = spyOutput("log");
		await run(["webapi", "-d", "/tmp/my-project"]);
		expect(onHost.join("\n")).toContain("Dev Container");

		vi.stubEnv("REMOTE_CONTAINERS", "true");
		const inContainer = spyOutput("log");
		await run(["webapi", "-d", "/tmp/my-project"]);
		expect(inContainer.join("\n")).not.toContain("Dev Container");
		expect(inContainer.join("\n")).toContain("pnpm install");
	});

	it("copies nothing after a failure, passes on the exit code and removes the container", async () => {
		containerExit = 7;
		const logs = spyOutput("log");

		await run(["webapi", "-d", "/tmp/my-project"]);

		expect(exitCode).toBe(7);
		expect(dockerCalls("cp")).toEqual([]);
		expect(mocks.mkdirSync).not.toHaveBeenCalled();
		expect(dockerCalls("rm")).toEqual([["rm", "-f", containerName()]]);
		expect(logs.join("\n")).not.toContain("Scaffold complete");
	});

	it("reports a failed copy, cleans up a folder it made, and removes the container", async () => {
		mocks.spawnSync.mockImplementation((_cmd: string, args: string[]) => ({
			status: args[0] === "cp" ? 1 : 0,
		}));
		const errors = spyOutput("error");

		await run(["webapi", "-d", "/tmp/my-project"]);

		expect(exitCode).toBe(1);
		expect(errors.join("\n")).toContain("docker cp failed");
		expect(mocks.rmSync).toHaveBeenCalledWith("/tmp/my-project", {
			recursive: true,
			force: true,
		});
		expect(dockerCalls("rm")).toEqual([["rm", "-f", containerName()]]);
	});

	it("removes only its temporary folder when the target already existed", async () => {
		mocks.existsSync.mockImplementation((path: string) => path === "/tmp/my-project");
		mocks.spawnSync.mockImplementation((_cmd: string, args: string[]) => ({
			status: args[0] === "cp" ? 1 : 0,
		}));
		spyOutput("error");

		await run(["webapi", "-d", "/tmp/my-project"]);

		expect(mocks.rmSync).toHaveBeenCalledWith("/target/.decohere-create-temp", {
			recursive: true,
			force: true,
		});
		expect(mocks.rmSync).not.toHaveBeenCalledWith("/tmp/my-project", expect.anything());
	});

	it("removes the container when interrupted", async () => {
		mocks.spawn.mockImplementation(() => new EventEmitter());

		// Never settles: the container is still running when the signal arrives.
		void run(["webapi", "-d", "/tmp/my-project"]);
		await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalled());

		expect(() => signalHandlers.get("SIGTERM")?.()).toThrow("process.exit(143)");
		expect(dockerCalls("rm")).toEqual([["rm", "-f", containerName()]]);
		expect(dockerCalls("cp")).toEqual([]);
	});

	it("refuses a folder that already has files, before starting anything", async () => {
		mocks.existsSync.mockImplementation((path: string) => path === "/tmp/my-project");
		mocks.readdirSync.mockReturnValue(["package.json"]);
		const errors = spyOutput("error");

		await run(["webapi", "-d", "/tmp/my-project"]);

		expect(exitCode).toBe(1);
		expect(errors.join("\n")).toContain("already has files");
		expect(mocks.spawnSync).not.toHaveBeenCalled();
	});

	it("accepts a folder holding only .git", async () => {
		mocks.existsSync.mockImplementation((path: string) => path === "/tmp/my-project");
		mocks.readdirSync.mockImplementation((dir: string) =>
			dir === "/tmp/my-project" ? [".git"] : [],
		);

		await run(["webapi", "-d", "/tmp/my-project"]);

		expect(exitCode).toBe(0);
		expect(dockerCalls("cp")).toHaveLength(1);
	});

	describe("the generated admin password", () => {
		const writtenProject = () => {
			mocks.existsSync.mockImplementation((path: string) => path.endsWith("/.env"));
			mocks.readFileSync.mockReturnValue(
				"AUTH0_ADMIN_USER_SUB=auth0|1\nAUTH0_ADMIN_USER_EMAIL=admin@my-app.example\n",
			);
		};
		const createEnv = () =>
			mocks.spawnSync.mock.calls.find((c) => c[1][0] === "create")?.[2]
				.env as NodeJS.ProcessEnv;

		it("reaches the container by name only, never on the command line", async () => {
			await run(["webapi", "-d", "/tmp/my-project"]);

			const password = createEnv().DECOHERE_ADMIN_PASSWORD!;
			expect(password.length).toBeGreaterThan(20);
			expect(createArgs()).toContain("DECOHERE_ADMIN_PASSWORD");
			expect(createArgs().join(" ")).not.toContain(password);
		});

		const noKeyStore = () => {
			mocks.spawnSync.mockImplementation((command: string) =>
				command === "secret-tool"
					? { status: null, error: new Error("spawn secret-tool ENOENT") }
					: { status: 0 },
			);
		};

		it("goes in the Linux key store over stdin, and isn't printed or put in a file", async () => {
			vi.spyOn(process, "platform", "get").mockReturnValue("linux");
			writtenProject();
			const logs = spyOutput("log");

			await run(["webapi", "-d", "/tmp/my-project"]);

			const password = createEnv().DECOHERE_ADMIN_PASSWORD!;
			const call = mocks.spawnSync.mock.calls.find((c) => c[0] === "secret-tool")!;
			expect(call[1]).toEqual(
				expect.arrayContaining(["store", "service", "decohere", "project", "my-project"]),
			);
			expect(call[1].join(" ")).not.toContain(password);
			expect(call[2].input).toBe(password);
			expect(mocks.writeFileSync).not.toHaveBeenCalled();
			expect(mocks.rmSync).toHaveBeenCalledWith(
				expect.stringMatching(/\.config\/decohere\/my-project\.env$/),
				{ force: true },
			);
			expect(logs.join("\n")).toContain(
				"secret-tool lookup service decohere project my-project",
			);
			expect(logs.join("\n")).not.toContain(password);
		});

		it("doesn't try the key store outside Linux", async () => {
			vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
			writtenProject();
			spyOutput("log");

			await run(["webapi", "-d", "/tmp/my-project"]);

			expect(mocks.spawnSync.mock.calls.some((c) => c[0] === "secret-tool")).toBe(false);
			expect(mocks.writeFileSync).toHaveBeenCalledOnce();
		});

		it("falls back to a private file with no key store, and never prints it", async () => {
			vi.spyOn(process, "platform", "get").mockReturnValue("linux");
			noKeyStore();
			writtenProject();
			const logs = spyOutput("log");
			const errors = spyOutput("error");

			await run(["webapi", "-d", "/tmp/my-project"]);

			const password = createEnv().DECOHERE_ADMIN_PASSWORD!;
			const [file, content, options] = mocks.writeFileSync.mock.calls[0]!;
			expect(file).toMatch(/\.config\/decohere\/my-project\.env$/);
			expect(file).not.toContain("/tmp/my-project/");
			expect(content).toContain(`AUTH0_ADMIN_USER_PASSWORD=${password}`);
			expect(content).toContain("AUTH0_ADMIN_USER_EMAIL=admin@my-app.example");
			expect(options).toEqual({ mode: 0o600 });
			expect(mocks.chmodSync).toHaveBeenCalledWith(file, 0o600);
			expect(mocks.mkdirSync).toHaveBeenCalledWith(
				expect.stringMatching(/\.config\/decohere$/),
				{
					recursive: true,
					mode: 0o700,
				},
			);
			expect(logs.join("\n")).toContain(file);
			expect([...logs, ...errors].join("\n")).not.toContain(password);
		});

		it("isn't saved when no admin user was created", async () => {
			mocks.existsSync.mockImplementation((path: string) => path.endsWith("/.env"));
			mocks.readFileSync.mockReturnValue("NODE_ENV=dev\n");

			await run(["webapi", "-d", "/tmp/my-project"]);

			expect(mocks.writeFileSync).not.toHaveBeenCalled();
			expect(mocks.spawnSync.mock.calls.some((c) => c[0] === "secret-tool")).toBe(false);
		});

		it("isn't saved after a failed run", async () => {
			writtenProject();
			containerExit = 1;

			await run(["webapi", "-d", "/tmp/my-project"]);

			expect(mocks.writeFileSync).not.toHaveBeenCalled();
			expect(mocks.spawnSync.mock.calls.some((c) => c[0] === "secret-tool")).toBe(false);
		});
	});

	it("copies nothing for --help", async () => {
		mocks.existsSync.mockReturnValue(true);
		mocks.readdirSync.mockReturnValue(["package.json"]);

		await run(["--help"]);

		expect(createArgs()).toContain("--help");
		expect(dockerCalls("cp")).toEqual([]);
		expect(exitCode).toBe(0);
	});

	it.each([
		[["add", "auth0"]],
		[["add", "api", "billing"]],
		[["webapi", "add", "billing"]],
		[["auth0", "login"]],
		[["auth0", "configure"]],
	])("%j says to open the Dev Container and starts no container", async (argv) => {
		const errors = spyOutput("error");

		await run(argv);

		expect(exitCode).toBe(1);
		expect(errors.join("\n")).toContain("Dev Container");
		expect(mocks.spawnSync).not.toHaveBeenCalled();
		expect(mocks.execFileSync).not.toHaveBeenCalled();
		expect(mocks.mkdirSync).not.toHaveBeenCalled();
	});
});

describe("launch inside a container with Decohere's tools", () => {
	beforeEach(() => {
		vi.stubEnv("DECOHERE_TOOLS", "1");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	function scaffoldCall(): { args: string[]; cwd: string; env: NodeJS.ProcessEnv } {
		const call = mocks.spawnSync.mock.calls.find((c) => c[0] === "npx");
		if (call == null) throw new Error("Expected the scaffolder to run with npx");
		return { args: call[1], cwd: call[2].cwd, env: call[2].env };
	}

	it("runs create right here, without Docker", async () => {
		await run(["my-app", "--database", "none"]);

		expect(mocks.spawnSync.mock.calls.some((c) => c[0] === "docker")).toBe(false);
		expect(mocks.execFileSync).not.toHaveBeenCalled();
		const { args, cwd, env } = scaffoldCall();
		expect(args).toEqual([
			"--yes",
			"@decohere/scaffold@0.0.1-test",
			"create",
			"webapi",
			"--database",
			"none",
			"-d",
			".",
		]);
		expect(cwd.endsWith("/my-app")).toBe(true);
		expect(env.DECOHERE_PROJECT_NAME).toBe("my-app");
		expect(mocks.mkdirSync).toHaveBeenCalledWith(cwd, { recursive: true });
	});

	it("runs commands on an existing project right here, in that project", async () => {
		await run(["add", "auth0"]);

		expect(mocks.spawnSync.mock.calls.some((c) => c[0] === "docker")).toBe(false);
		expect(scaffoldCall().args).toEqual(expect.arrayContaining(["add", "auth0", "-d", "."]));
		expect(mocks.mkdirSync).not.toHaveBeenCalled();
	});

	it("passes on the scaffolder's exit code", async () => {
		mocks.spawnSync.mockReturnValue({ status: 7 });
		await run(["add", "auth0"]);
		expect(exitCode).toBe(7);
	});

	it("reports a failure to start, rather than success", async () => {
		const errors: string[] = [];
		vi.spyOn(console, "error").mockImplementation((msg?: unknown) => {
			errors.push(String(msg ?? ""));
		});
		mocks.spawnSync.mockReturnValue({ status: null, error: new Error("spawn npx ENOENT") });

		await run(["add", "auth0"]);

		expect(exitCode).toBe(1);
		expect(errors.join("\n")).toContain("spawn npx ENOENT");
	});
});
