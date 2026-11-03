import { ConfigurationOption, DecohereCommand, DryRunOption } from "@decohere/devkit/cli";
import { Publish } from "../actions/publish.action.js";

export class PublishCommand extends DecohereCommand {
	public override get actions() {
		return [Publish];
	}

	public constructor(name: string) {
		super(name);
		this.description("Publish workspace packages");
		this.addOption(new ConfigurationOption("release"));
		this.addOption(new DryRunOption("Run npm publish using dry-run flag"));
		this.option("--channel <channel>", "The release channel", "beta");
		this.option("--token <token>", "npm access token (used only for this command)");
		this.option("--otp <otp>", "npm one-time password for 2FA-protected publish");
		this.option("--prompt-auth", "Prompt interactively for npm token and OTP", false);
		this.option(
			"--prompt-otp",
			"Prompt interactively for npm OTP only (use when already logged in)",
			false,
		);
	}
}
