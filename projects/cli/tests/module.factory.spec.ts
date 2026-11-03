import { injectable } from "@decohere/crucible/decorators";
import type { Action } from "@decohere/devkit/cli";
import { ActionResponse, DecohereCommand, ModuleManifest } from "@decohere/devkit/cli";
import { spyOnConstructor } from "@decohere/testing";
import type { OptionValues } from "commander";
import { expect, it, vi } from "vitest";
import { ModuleFactory } from "../src/module.factory.js";

// A minimal fake workspace type to stand in for a real workspace dependency.
class FakeWorkspace {
	public readonly name = "fake";
}

@injectable()
class WorkspaceDependentAction implements Action {
	public constructor(public readonly workspace: FakeWorkspace) {}
	public async run(): Promise<ActionResponse> {
		return ActionResponse.Success(WorkspaceDependentAction.name);
	}
}

class TestCommand extends DecohereCommand<{ action: WorkspaceDependentAction }> {
	public override get actions() {
		return [WorkspaceDependentAction] as const;
	}
	public constructor(
		_commands: Record<string, never>,
		handler: (opts: OptionValues, cmd: DecohereCommand) => Promise<void>,
	) {
		super("test");
		this.action(handler);
	}
}

it("should inject the workspace instance into actions when createWorkspace returns non-null", async () => {
	const { spy, Proxy: SpiedAction } = spyOnConstructor(WorkspaceDependentAction);

	class SpiedWorkspaceModule extends ModuleManifest {
		public readonly id = "test";
		public readonly command = TestCommand;
		public readonly actions = { action: SpiedAction };
		public override createWorkspace() {
			return Promise.resolve(new FakeWorkspace());
		}
	}

	const mod = ModuleFactory.create(new SpiedWorkspaceModule(), () => {});
	await mod.command.parseAsync([], { from: "user" });

	expect(spy).toHaveBeenCalledWith(expect.any(FakeWorkspace));
});

it("fails with the missing dependency when an action needs a workspace the module did not create", async () => {
	// The container throws for unregistered dependencies instead of injecting null, so the
	// command fails naming what was missing rather than crashing later on a null workspace.
	const { spy, Proxy: SpiedAction } = spyOnConstructor(WorkspaceDependentAction);

	class SpiedNoWorkspaceModule extends ModuleManifest {
		public readonly id = "test";
		public readonly command = TestCommand;
		public readonly actions = { action: SpiedAction };
		// createWorkspace returns null (the base class default)
	}

	const mod = ModuleFactory.create(new SpiedNoWorkspaceModule(), () => {});
	await expect(mod.command.parseAsync([], { from: "user" })).rejects.toThrow(
		/Nothing is registered for FakeWorkspace/,
	);
	expect(spy).not.toHaveBeenCalled();
});

it("should call Symbol.dispose on the container after the command handler completes", async () => {
	const dispose = vi.fn();

	@injectable()
	class DisposableAction implements Action {
		public async run(): Promise<ActionResponse> {
			return ActionResponse.Success(DisposableAction.name);
		}
		public [Symbol.dispose]() {
			dispose();
		}
	}

	class DisposableCommand extends DecohereCommand<{ action: DisposableAction }> {
		public override get actions() {
			return [DisposableAction] as const;
		}
		public constructor(
			_commands: Record<string, never>,
			handler: (opts: OptionValues, cmd: DecohereCommand) => Promise<void>,
		) {
			super("disposable");
			this.action(handler);
		}
	}

	class DisposableModule extends ModuleManifest {
		public readonly id = "test";
		public readonly command = DisposableCommand;
		public readonly actions = { action: DisposableAction };
	}

	const mod = ModuleFactory.create(new DisposableModule(), () => {});
	await mod.command.parseAsync([], { from: "user" });
	mod.dispose?.();

	expect(dispose).toHaveBeenCalledOnce();
});

it("should call Symbol.dispose on the workspace after the command handler completes", async () => {
	const dispose = vi.fn();

	class DisposableWorkspace {
		public [Symbol.dispose]() {
			dispose();
		}
	}

	@injectable()
	class WorkspaceConsumingAction implements Action {
		public constructor(public readonly workspace: DisposableWorkspace) {}
		public async run(): Promise<ActionResponse> {
			return ActionResponse.Success(WorkspaceConsumingAction.name);
		}
	}

	class DisposableWorkspaceCommand extends DecohereCommand<{
		action: WorkspaceConsumingAction;
	}> {
		public override get actions() {
			return [WorkspaceConsumingAction] as const;
		}
		public constructor(
			_commands: Record<string, never>,
			handler: (opts: OptionValues, cmd: DecohereCommand) => Promise<void>,
		) {
			super("disposable-ws");
			this.action(handler);
		}
	}

	class DisposableWorkspaceModule extends ModuleManifest {
		public readonly id = "test";
		public readonly command = DisposableWorkspaceCommand;
		public readonly actions = { action: WorkspaceConsumingAction };
		public override createWorkspace() {
			return Promise.resolve(new DisposableWorkspace());
		}
	}

	const mod = ModuleFactory.create(new DisposableWorkspaceModule(), () => {});
	await mod.command.parseAsync([], { from: "user" });
	mod.dispose?.();

	expect(dispose).toHaveBeenCalledOnce();
});
