import type { MergeOptions } from "@decohere/devkit/cli";
import {
	CommandResponse,
	ConfigurationOption,
	DecohereCommand,
	NoCleanOptions,
} from "@decohere/devkit/cli";
import auto from "async/auto.js";
import type { Build } from "../actions/build.action.js";
import type { Clean } from "../actions/clean.action.js";
import type { Copy } from "../actions/copy.action.js";
import type { Watch } from "../actions/watch.action.js";

export type BuildActions = { clean: Clean; build: Build; watch: Watch; copy: Copy };
export class BuildCommand extends DecohereCommand<BuildActions> {
	public constructor(name?: string) {
		super(name ?? BuildCommand.name);
		this.description("Build workspace projects");
		this.addOption(new ConfigurationOption("debug"));
		this.addOption(new NoCleanOptions(true));
		this.option("--no-copy", "Will not copy files like package.json to outdir", true);
		this.option("--watch", "Watches for changes in the source dir", false);
		this.option("--file <file>", "File to build");
	}

	public override runsUntilStopped(options: Record<string, unknown>): boolean {
		return options.watch === true;
	}

	public run = async (
		actions: BuildActions,
		options: MergeOptions<BuildActions>,
	): Promise<CommandResponse<BuildActions>> => {
		const responses = await auto<BuildActions>({
			clean: async () => await actions.clean.run(options),
			build: ["clean", async () => await actions.build.run(options)],
			copy: ["clean", async () => await actions.copy.run(options)],
			watch: ["build", "copy", async () => await actions.watch.run(options)],
		});

		return CommandResponse.success(options, responses);
	};
}
