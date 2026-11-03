import type { CommandHandler } from "@decohere/devkit/cli";
import { CommandResponse, ConfigurationOption, DecohereCommand } from "@decohere/devkit/cli";
import type { CommitFilesOptions } from "../actions/commit.action.js";
import { CommitFiles } from "../actions/commit.action.js";
import { ReportDependencies } from "../actions/dependency-report.action.js";
import type { DependenciesOptions } from "../actions/dependency-sync.action.js";
import { SyncDependencies as DependencySync } from "../actions/dependency-sync.action.js";
import type { SyncLockFileOptions } from "../actions/sync-lock-file.action.js";
import { SyncLockFile } from "../actions/sync-lock-file.action.js";
import { Release } from "../workspace.config.js";

export class DependencyCommand extends DecohereCommand {
	public constructor(name?: string, handler?: CommandHandler) {
		super(name ?? DependencyCommand);
		this.description("Analyze and sync workspace dependencies");
		this.addOption(new ConfigurationOption("release"));
		this.registerSubcommand(ReportCommand, handler);
		this.registerSubcommand(SyncCommand, handler);
	}
}

type SyncActions = {
	syncDependencies: DependencySync;
	syncLockFile: SyncLockFile;
	commitFiles: CommitFiles;
};

class SyncCommand extends DecohereCommand<SyncActions> {
	public override get actions() {
		return [DependencySync, SyncLockFile, CommitFiles];
	}

	public constructor() {
		super(SyncCommand);
		this.description("Sync workspace dependency manifests");
		this.option(
			"--log-diff",
			"Log what changed in each project's dependencies after syncing",
			false,
		);
		this.option("--no-sync", "Skip lockfile sync after syncing dependencies", true);
		this.option("--commit", "Commit synced workspace manifest changes", false);
		this.option("--message <message>", "Commit message (used with --commit)");
	}

	public override async run(actions: SyncActions, options: Record<string, unknown>) {
		const responses: CommandResponse<SyncActions> = {};
		const configuration =
			typeof options.configuration === "string" ? options.configuration : Release.name;

		const syncDependencyOptions: DependenciesOptions = {
			configuration,
			logDiff: options.logDiff === true,
		};

		const syncLockOptions: SyncLockFileOptions = {
			sync: options.sync !== false,
			dryRun: options.dryRun === true,
		};

		const commitOptions: CommitFilesOptions = {
			configuration,
			commit: options.commit === true,
			dryRun: options.dryRun === true,
			message: typeof options.message === "string" ? options.message : undefined,
		};

		responses.syncDependencies = await actions.syncDependencies.run(syncDependencyOptions);
		this.throwOnErrors({ syncDependencies: responses.syncDependencies });

		responses.syncLockFile = await actions.syncLockFile.run(syncLockOptions);
		this.throwOnErrors({ syncLockFile: responses.syncLockFile });

		responses.commitFiles = await actions.commitFiles.run(commitOptions);
		this.throwOnErrors({ commitFiles: responses.commitFiles });

		return CommandResponse.success(options, responses);
	}
}

class ReportCommand extends DecohereCommand {
	public override get actions() {
		return [ReportDependencies];
	}

	public constructor() {
		super(ReportCommand);
		this.description("Report resolved dependencies for workspace projects");
		this.option("--file <file>", "Optional file path to write the report to");
		this.option(
			"--fail-on-drift",
			"Exit with an error if resolved dependencies differ from what is declared in package.json",
			false,
		);
	}
}
