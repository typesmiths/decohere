import { ConfigurationOption, DecohereCommand } from "@decohere/devkit/cli";
import type { OptionValues } from "commander";
import { RunAction } from "./run.action.js";

export class RunCommand extends DecohereCommand {
	public override get actions() {
		return [RunAction];
	}

	public constructor(name: string) {
		super(name);
		this.description("Compile and run a TypeScript entry on the fly (no watch / HMR)");
		this.argument("<entry>", "Path to the TypeScript entry file");
		this.argument("[args...]", "Arguments forwarded to the entry after rewriting argv");
		this.addOption(new ConfigurationOption("debug"));
	}

	/**
	 * Commander passes positionals before options when `<entry> [args...]` is declared.
	 * The CLI host ModuleFactory expects `(opts, cmd)` — normalize and stash entry/args on opts.
	 */
	public override action(fn: (...args: any[]) => void | Promise<void>): this {
		return super.action((...args: any[]) => {
			const cmd = args.at(-1) as DecohereCommand;
			const opts = args.at(-2) as OptionValues;
			const { entry, entryArgs } = normalizeRunPositionals(args.slice(0, -2));
			cmd.setOptionValue("entry", entry);
			cmd.setOptionValue("args", entryArgs);
			return fn(opts, cmd);
		});
	}
}

/** Commander yields `[entry, args[]]` or sometimes a flat list depending on arity. */
function normalizeRunPositionals(positionals: unknown[]): {
	entry: string;
	entryArgs: string[];
} {
	if (positionals.length === 0) {
		return { entry: "", entryArgs: [] };
	}

	const first = positionals[0];
	if (typeof first !== "string" || first === "") {
		return { entry: "", entryArgs: [] };
	}

	const second = positionals[1];
	if (Array.isArray(second)) {
		return {
			entry: first,
			entryArgs: second.filter((s): s is string => typeof s === "string"),
		};
	}

	return {
		entry: first,
		entryArgs: positionals
			.slice(1)
			.filter((s): s is string => typeof s === "string" && s !== ""),
	};
}
