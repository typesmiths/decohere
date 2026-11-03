import { ConfigurationOption, DecohereCommand, DryRunOption } from "@decohere/devkit/cli";
import { Docker } from "../actions/docker.action.js";

export class DockerCommand extends DecohereCommand {
	public override get actions() {
		return [Docker];
	}

	public constructor(name: string) {
		super(name);
		this.description("Build Docker images for workspace projects");
		this.addOption(new ConfigurationOption("release"));
		this.addOption(new DryRunOption("Build images without pushing to a registry"));
		this.option("--push", "Push built images after a successful build", false);
	}
}
