import { ConfigurationOption, DecohereCommand, DryRunOption } from "@decohere/devkit/cli";
import { SyncLockFile } from "../actions/sync-lock-file.action.js";
import { DefaultChannel, DefaultReleaseType, Version } from "../actions/version.action.js";

type VersionActions = { version: Version; syncLockFile: SyncLockFile };

export class VersionCommand extends DecohereCommand<VersionActions> {
	public override get actions() {
		return [Version, SyncLockFile];
	}

	public constructor(name: string) {
		super(name);
		this.description("Bump workspace package versions");
		this.addOption(new ConfigurationOption("release"));
		this.addOption(new DryRunOption("Run npm publish using dry-run flag"));
		this.option(
			"--release-type <releaseType>",
			"The semver release type: major, minor, patch, prerelease",
			DefaultReleaseType,
		);
		this.option(
			"--channel <channel>",
			"The release channel (preid for prereleases, dist-tag for publish)",
			DefaultChannel,
		);
		this.option(
			"--version <version>",
			"Explicit base version to increment (overrides git tag discovery)",
		);
		this.option(
			"--build-number <number>",
			"Set <base>-<channel>.<commit's UTC date>.<number>, with no git tags involved",
		);
		this.option(
			"--from-build",
			"Copy the version from the built packages; fails if they don't all match",
			false,
		);
		this.option("--no-sync", "Skip lockfile sync after versioning", true);
		this.option("--commit", "Commit versioned package.json files after bumping", false);
		this.option("--message <message>", "Commit message (used with --commit)");
		this.option(
			"--from-changesets",
			"Read pending .changeset entries to determine the highest bump type (major > minor > patch)",
			false,
		);
	}
}
