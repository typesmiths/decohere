import { WorkspaceFactory } from "@decohere/workspace";
import type {
	Action,
	CommandClassMap,
	CommandHandler,
	CommandType,
} from "@decohere/devkit/cli";
import {
	ActionResponse,
	CommandResponse,
	DecohereCommand,
	ModuleManifest,
} from "@decohere/devkit/cli";
import { resetMemfs } from "@decohere/testing";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleFactory } from "../src/module.factory.js";
import { RootModule } from "../src/root.module.js";

beforeEach(() => {
	vi.restoreAllMocks();
});

afterEach(() => {
	resetMemfs();
});

describe("module registration", () => {
	class MockCommand extends DecohereCommand {
		public constructor(commands: Record<string, CommandType>, handler: CommandHandler) {
			super("mock");
			this.registerSubcommand(commands, handler);
		}
	}

	class MockSubCommand extends DecohereCommand {
		public constructor() {
			super("sub");
		}
	}

	class MockModule extends ModuleManifest {
		public readonly id = "mock";
		public readonly command = MockCommand;
	}

	class MockModuleWithSubs extends ModuleManifest {
		public readonly id = "mock";
		public readonly command = MockCommand;
		public readonly commands: CommandClassMap = { sub: MockSubCommand };
	}

	it("registers a module command with the same name as the module id", async () => {
		const app = await RootModule.create([MockModule]);

		expect(app.commands.at(0).name()).toBe("mock");
	});

	it("adds module subcommands to the module root command", async () => {
		const app = await RootModule.create([MockModuleWithSubs]);
		const subcommandNames = app.commands.at(0).commands.map((c) => c.name());

		expect(subcommandNames).toContain("sub");
	});
});

describe("command routing", () => {
	class ActionA implements Action {
		public async run(): Promise<ActionResponse> {
			return ActionResponse.Success("A");
		}
	}

	class ActionB implements Action {
		public async run(): Promise<ActionResponse> {
			return ActionResponse.Success("B");
		}
	}

	class CommandA extends DecohereCommand<{ a: Action }> {
		public override get actions() {
			return [ActionA] as const;
		}

		public constructor(_commands: Record<string, CommandType>, handler: CommandHandler) {
			super("module-a");
			this.action(handler);
		}
	}

	class CommandB extends DecohereCommand<{ b: Action }> {
		public override get actions() {
			return [ActionB] as const;
		}

		public constructor(_commands: Record<string, CommandType>, handler: CommandHandler) {
			super("module-b");
			this.action(handler);
		}
	}

	class ModuleA extends ModuleManifest {
		public readonly id = "module-a";
		public readonly command = CommandA;
		public readonly actions = { a: ActionA };
	}

	class ModuleB extends ModuleManifest {
		public readonly id = "module-b";
		public readonly command = CommandB;
		public readonly actions = { b: ActionB };
	}

	it("routes invocation to the correct module", async () => {
		const spyA = vi
			.spyOn(ActionA.prototype, "run")
			.mockResolvedValue(ActionResponse.Success("A"));
		const spyB = vi
			.spyOn(ActionB.prototype, "run")
			.mockResolvedValue(ActionResponse.Success("B"));

		const app = await RootModule.create([ModuleA, ModuleB]);
		await app.run(["module-a"]);

		expect(spyA).toHaveBeenCalledOnce();
		expect(spyB).not.toHaveBeenCalled();
	});
});

describe("user config", () => {
	const fixtureDir = new URL("__fixtures__", import.meta.url).pathname;
	const configFile = `${fixtureDir}/.decohere.js`;

	class MockCommand extends DecohereCommand {
		public constructor(commands: Record<string, CommandType>, handler: CommandHandler) {
			super("mock");
			this.registerSubcommand(commands, handler);
		}
	}

	class MockModule extends ModuleManifest {
		public readonly id = "mock";
		public readonly command = MockCommand;
	}

	it("merges user-defined commands from config into the module", async () => {
		vol.fromJSON({
			[configFile]: `export default { mock: { commands: { "user-cmd": class extends (await import("commander")).Command {} } } }`,
		});
		const app = await RootModule.create([MockModule], { configFile });
		const subcommandNames = app.commands.at(0).commands.map((c) => c.name());

		expect(subcommandNames).toContain("user-cmd");
	});
});

describe("parameterless command", () => {
	class RootCommand extends DecohereCommand {
		public override async run() {
			return CommandResponse.fromAction("result", ActionResponse.Success("done"));
		}
	}

	class SimpleModule extends ModuleManifest {
		public readonly id = "simple";
		public readonly command = RootCommand;
	}

	it("uses the module id as the command name", async () => {
		const app = await RootModule.create([SimpleModule]);
		expect(app.commands.at(0).name()).toBe("simple");
	});

	it("can run without actions using CommandResponse.fromAction", async () => {
		const app = await RootModule.create([SimpleModule]);
		const response = await app.run(["simple"]);

		expect(response).toEqual({ result: expect.objectContaining({ succeeded: true }) });
	});
});

describe("help and version flag", () => {
	class SimpleModule extends ModuleManifest {
		public readonly id = "simple";
		public readonly command = DecohereCommand;
	}

	it("returns an empty response when --help is passed", async () => {
		const app = await RootModule.create([SimpleModule]);
		const response = await app.run(["--help"]);

		expect(response).toEqual(CommandResponse.help());
	});

	it("returns an empty response when a subcommand --help is passed", async () => {
		const app = await RootModule.create([SimpleModule]);
		const response = await app.run(["simple", "--help"]);

		expect(response).toEqual(CommandResponse.help());
	});

	it("returns an empty response when --version is passed", async () => {
		vi.spyOn(WorkspaceFactory, "create").mockResolvedValue({
			getVersion: vi.fn().mockResolvedValue("1.0.0"),
		} as unknown as Awaited<ReturnType<typeof WorkspaceFactory.create>>);

		const app = await RootModule.create([SimpleModule]);
		const response = await app.run(["--version"]);

		expect(response).toEqual(CommandResponse.help());
	});
});

describe("dispose", () => {
	it("calls dispose on each wired module", async () => {
		const dispose = vi.fn();

		vi.spyOn(ModuleFactory, "create").mockReturnValue({
			id: "mock",
			command: new DecohereCommand(),
			dispose,
		});

		class MockModule extends ModuleManifest {
			public readonly id = "mock";
			public readonly command = DecohereCommand;
		}

		const app = await RootModule.create([MockModule]);
		app[Symbol.dispose]();

		expect(dispose).toHaveBeenCalledOnce();
	});
});

describe("error handling", () => {
	class ThrowingAction implements Action {
		public async run(): Promise<ActionResponse> {
			throw new Error("boom");
		}
	}

	class ThrowingCommand extends DecohereCommand<{ action: ThrowingAction }> {
		public override get actions() {
			return [ThrowingAction] as const;
		}

		public constructor(_commands: Record<string, CommandType>, handler: CommandHandler) {
			super("throw-cmd");
			this.action(handler);
		}
	}

	class ThrowingModule extends ModuleManifest {
		public readonly id = "throw-cmd";
		public readonly command = ThrowingCommand;
		public readonly actions = { action: ThrowingAction };
	}

	it("re-throws errors from a command action so the caller can handle the exit code", async () => {
		const app = await RootModule.create([ThrowingModule]);
		await expect(app.run(["throw-cmd"])).rejects.toThrow("boom");
	});

	it("returns a failed response for actions that return ActionResponse.Error without throwing", async () => {
		class FailingAction implements Action {
			public async run(): Promise<ActionResponse> {
				return ActionResponse.Error("FailingAction", "something went wrong");
			}
		}

		// A command that collects the response without throwing on errors,
		// so the failed response propagates to the caller via onResponse.
		class FailingCommand extends DecohereCommand<{ action: FailingAction }> {
			public override get actions() {
				return [FailingAction] as const;
			}

			public constructor(_commands: Record<string, CommandType>, handler: CommandHandler) {
				super("fail-cmd");
				this.action(handler);
			}

			public override async run(
				actions: { action: FailingAction },
				options: Record<string, unknown>,
			) {
				const response = await this.runActions(actions, options);
				return CommandResponse.success(options, response);
			}
		}

		class FailingModule extends ModuleManifest {
			public readonly id = "fail-cmd";
			public readonly command = FailingCommand;
			public readonly actions = { action: FailingAction };
		}

		const app = await RootModule.create([FailingModule]);
		const response = await app.run(["fail-cmd"]);

		expect(response.action?.succeeded).toBe(false);
		expect(response.action?.message).toBe("something went wrong");
	});
});

// process.loadEnvFile reads the real disk, not memfs.
const realFs = await vi.importActual<typeof import("node:fs")>("node:fs");
const { tmpdir } = await vi.importActual<typeof import("node:os")>("node:os");
const { join } = await vi.importActual<typeof import("node:path")>("node:path");

describe("--env-file", () => {
	const key = "DECOHERE_ENV_FILE_SENTINEL";
	let seen: string | undefined;

	class EnvCommand extends DecohereCommand {
		public override async run() {
			seen = process.env[key];
			return CommandResponse.fromAction("result", ActionResponse.Success("done"));
		}
	}

	class EnvModule extends ModuleManifest {
		public readonly id = "env";
		public readonly command = EnvCommand;
	}

	afterEach(() => {
		delete process.env[key];
		seen = undefined;
	});

	it("loads the named file into the environment before the command runs", async () => {
		const dir = realFs.mkdtempSync(join(tmpdir(), "decohere-env-file-"));
		const file = join(dir, "local.env");
		realFs.writeFileSync(file, `${key}=from-file\n`);
		try {
			const app = await RootModule.create([EnvModule]);
			await app.run(["env", "--env-file", file]);
			expect(seen).toBe("from-file");
		} finally {
			realFs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("--env-file-if-exists loads the file when present and skips it when missing", async () => {
		const dir = realFs.mkdtempSync(join(tmpdir(), "decohere-env-file-"));
		const file = join(dir, "local.env");
		try {
			const app = await RootModule.create([EnvModule]);
			await app.run(["env", "--env-file-if-exists", file]);
			expect(seen).toBeUndefined();

			realFs.writeFileSync(file, `${key}=from-file\n`);
			await (await RootModule.create([EnvModule])).run(["env", "--env-file-if-exists", file]);
			expect(seen).toBe("from-file");
		} finally {
			realFs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("loads nothing when the option is not given", async () => {
		const app = await RootModule.create([EnvModule]);
		await app.run(["env"]);
		expect(seen).toBeUndefined();
	});
});
