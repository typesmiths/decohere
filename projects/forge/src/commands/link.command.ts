import type { CommandHandler, MergeOptions } from "@decohere/devkit/cli";
import {
	CommandResponse,
	ConfigurationOption,
	DecohereCommand,
	NoCleanOptions,
} from "@decohere/devkit/cli";
import auto from "async/auto.js";
import { Build } from "../actions/build.action.js";
import { Clean } from "../actions/clean.action.js";
import { Copy } from "../actions/copy.action.js";
import { Link } from "../actions/link.action.js";
import { Unlink } from "../actions/unlink.action.js";
import { Watch } from "../actions/watch.action.js";

export type LinkActions = { clean: Clean; build: Build; copy: Copy; link: Link; watch: Watch };
type UnlinkActions = { unlink: Unlink };

export class LinkCommand extends DecohereCommand<LinkActions> {
	public override get actions() {
		return [Clean, Build, Copy, Link, Watch];
	}

	public constructor(name?: string) {
		super(name ?? "link");
		this.description("Symlink workspace build outputs into a consumer project's node_modules");
		this.addOption(new ConfigurationOption("link"));
		this.addOption(new NoCleanOptions(true));
		this.option("--build", "Run forge build concurrently after linking", false);
		this.option("--no-copy", "Will not copy files like package.json to outdir", true);
		this.option("--target-dir <dir>", "Path to the consumer project root");
		this.option("--watch", "Watch for changes after linking", false);
	}

	public override runsUntilStopped(options: Record<string, unknown>): boolean {
		return options.watch === true;
	}

	public run = async (
		actions: LinkActions,
		options: MergeOptions<LinkActions>,
	): Promise<CommandResponse<LinkActions>> => {
		const responses = await auto<LinkActions>({
			clean: async () => await actions.clean.run(options),
			link: ["clean", async () => await actions.link.run(options)],
			build: ["link", async () => await actions.build.run(options)],
			copy: ["link", async () => await actions.copy.run(options)],
			watch: ["link", async () => await actions.watch.run(options)],
		});

		return CommandResponse.success(options, responses);
	};
}

export class UnlinkCommand extends DecohereCommand<UnlinkActions> {
	public override get actions() {
		return [Unlink];
	}

	public constructor(name?: string, handler?: CommandHandler) {
		super(name ?? "unlink");
		this.description("Remove workspace symlinks from a consumer project's node_modules");
		this.option("--target-dir <dir>", "Path to the consumer project root");
		if (handler) this.action(handler);
	}
}
