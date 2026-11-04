import { WorkspaceFactory } from "@decohere/workspace";
import {
	type ApplicationModule,
	ConfigFileOption,
	DecohereCommand,
	EnvFileIfExistsOption,
	EnvFileOption,
	LogLevelOption,
	RootDirOption,
} from "@decohere/devkit/cli";
import { CommanderError, type ParseOptions } from "commander";

export class RootCommand extends DecohereCommand {
	readonly #configFile?: string;
	readonly #rootDir?: string;

	public constructor(modules: ApplicationModule[], configFile?: string, rootDir?: string) {
		super();
		this.#configFile = configFile;
		this.#rootDir = rootDir;
		this.addOption(new ConfigFileOption());
		this.addOption(new RootDirOption());
		this.addOption(new LogLevelOption());
		this.addOption(new EnvFileOption());
		this.addOption(new EnvFileIfExistsOption());
		// Explicit opt-in: nothing reads a .env file unless the command line names one.
		this.hook("preAction", (command) => {
			const { envFile, envFileIfExists } = command.opts<{
				envFile?: string;
				envFileIfExists?: string;
			}>();
			if (envFile) process.loadEnvFile(envFile);
			if (envFileIfExists) loadEnvFileIfExists(envFileIfExists);
		});

		for (const mod of modules) {
			this.addCommand(mod.command);
		}
	}

	public override async parseAsync(
		argv?: readonly string[],
		options?: ParseOptions,
	): Promise<this> {
		if (argv?.includes("--version") || argv?.includes("-V")) {
			const workspace = await WorkspaceFactory.create({
				configFile: this.#configFile,
				rootDir: this.#rootDir,
			});
			const version = (await workspace.getVersion()) ?? "unknown";
			process.stdout.write(`${version}\n`);
			throw new CommanderError(0, "commander.version", version);
		}

		return super.parseAsync(argv as string[], options);
	}
}

function loadEnvFileIfExists(path: string): void {
	try {
		process.loadEnvFile(path);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
	}
}
