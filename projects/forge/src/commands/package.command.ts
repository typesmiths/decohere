import { DecohereCommand } from "@decohere/devkit/cli";
import { PackageDeployable } from "../actions/package.action.js";

function collect(value: string, previous: string[]): string[] {
	return [...previous, value];
}

export class PackageCommand extends DecohereCommand {
	public override get actions() {
		return [PackageDeployable];
	}

	public constructor(name: string) {
		super(name);
		this.description(
			"Package a deployable (a project with a Dockerfile) with the workspace libraries it imports",
		);
		this.argument(
			"[project]",
			"Package name of the deployable; omit to package every project with a Dockerfile",
		);
		this.option(
			"--env <name>",
			"Environment whose config files to include; repeat for more. Default production",
			collect,
			[],
		);
		this.option(
			"--app <name>",
			"App whose config files to include; repeat for more. Default the project's folder name",
			collect,
			[],
		);
	}

	/**
	 * Commander passes the positional before the options; the CLI host reads only options,
	 * so the project name is stashed on them.
	 */
	public override action(fn: (...args: any[]) => void | Promise<void>): this {
		return super.action((...args: any[]) => {
			const cmd = args.at(-1) as DecohereCommand;
			const opts = args.at(-2) as Record<string, unknown>;
			const project = typeof args[0] === "string" ? args[0] : undefined;
			cmd.setOptionValue("project", project);
			return fn(opts, cmd);
		});
	}
}
