import type { OptionValues } from "commander";
import { expect, it, vi } from "vitest";
import type { Action } from "../../src/cli/index.js";
import { ActionResponse, DecohereCommand } from "../../src/cli/index.js";

type TestActions = {
	a: Action;
	b: Action;
};

class AAction implements Action {
	public constructor(
		private readonly response: ActionResponse = ActionResponse.Success("a"),
	) {}

	public async run(): Promise<ActionResponse> {
		return this.response;
	}
}

class BAction implements Action {
	public constructor(
		private readonly response: ActionResponse = ActionResponse.Success("b"),
	) {}

	public async run(): Promise<ActionResponse> {
		return this.response;
	}
}

class TestCommand extends DecohereCommand<TestActions> {
	public override get actions() {
		return [AAction, BAction] as const;
	}

	public constructor() {
		super("test");
	}
}

it("does not throw when an action is skipped", async () => {
	const command = new TestCommand();
	const actions: TestActions = {
		a: new AAction(ActionResponse.Skipped("a")),
		b: new BAction(ActionResponse.Success("b")),
	};
	const runA = vi.spyOn(actions.a, "run");
	const runB = vi.spyOn(actions.b, "run");

	const response = await command.run(actions, {} as OptionValues);
	expect(runA).toHaveBeenCalledTimes(1);
	expect(runB).toHaveBeenCalledTimes(1);
	expect(response.a?.skipped).toBe(true);
	expect(response.b?.succeeded).toBe(true);
});

it("throws when an action returns a non-skipped error", async () => {
	const command = new TestCommand();
	const actions: TestActions = {
		a: new AAction(ActionResponse.Error("a", "a failed")),
		b: new BAction(ActionResponse.Skipped("b")),
	};

	await expect(command.run(actions, {} as OptionValues)).rejects.toThrow(
		"test command failed",
	);
});

it("throws when mapped action constructor is missing", async () => {
	class MissingBCommand extends DecohereCommand<TestActions> {
		public override get actions() {
			return [AAction, BAction] as const;
		}

		public constructor() {
			super("test");
		}
	}

	const command = new MissingBCommand();
	const actions: TestActions = {
		a: new AAction(),
		b: {
			run: async () => ActionResponse.Success("b"),
		},
	};

	await expect(command.run(actions, {} as OptionValues)).rejects.toThrow(
		"missing action instance for BAction",
	);
});
