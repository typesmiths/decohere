import { ConfigurationOption, DecohereCommand, ProjectOption } from "@decohere/devkit/cli";
import type { OptionValues } from "commander";
import { DEFAULT_REBOOT_DEBOUNCE_MS, resolveRebootDebounceMs } from "./hot-reload-server.js";
import { ServeAction } from "./serve.action.js";

export class ServeCommand extends DecohereCommand {
	public override get actions() {
		return [ServeAction];
	}

	public constructor(name: string) {
		super(name);
		this.description(
			"Serve a project or directory slices (Flux apps in-process; foreign packages via package scripts)",
		);
		this.argument(
			"[slices...]",
			"Module directories to serve (e.g. funding shell secmaster, or projects/funding)",
		);
		this.addOption(new ConfigurationOption("debug"));
		this.addOption(new ProjectOption());
		this.option(
			"--reboot-debounce-ms <ms>",
			"Quiet window in milliseconds after the last affecting save before a reboot",
			(value: string) => resolveRebootDebounceMs(Number(value)),
			DEFAULT_REBOOT_DEBOUNCE_MS,
		);
	}

	public override runsUntilStopped(): boolean {
		return true;
	}

	/**
	 * Commander passes positional args before options when `[slices...]` is declared.
	 * The CLI host ModuleFactory expects `(opts, cmd)` — normalize here.
	 */
	public override action(fn: (...args: any[]) => void | Promise<void>): this {
		return super.action((...args: any[]) => {
			const cmd = args.at(-1) as DecohereCommand;
			const first = args[0];
			const hasPositionalSlices =
				Array.isArray(first) || typeof first === "string" || first === undefined;
			const opts = hasPositionalSlices ? (args[1] as OptionValues) : (args[0] as OptionValues);

			const slices = normalizePositionalSlices(first);
			if (slices.length > 0) {
				cmd.setOptionValue("slices", slices);
			}
			return fn(opts, cmd);
		});
	}
}
function normalizePositionalSlices(first: unknown): string[] {
	if (Array.isArray(first)) {
		return first.filter((s): s is string => typeof s === "string" && s !== "");
	}
	if (typeof first === "string" && first !== "") {
		return [first];
	}
	return [];
}
