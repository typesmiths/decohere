import { Option } from "commander";

function parseOptionalBoolean(input: string | boolean): boolean {
	if (typeof input === "boolean") {
		return input;
	}

	const value = input.trim().toLowerCase();
	if (["true", "1", "yes", "on"].includes(value)) {
		return true;
	}
	if (["false", "0", "no", "off"].includes(value)) {
		return false;
	}

	throw new Error(`Invalid boolean value: "${input}". Use true/false.`);
}

export class ConfigurationOption extends Option {
	public constructor(defaultValue: string) {
		super("--configuration <configuration>", "Configuration name");
		this.default(defaultValue);
	}
}

export class ConfigFileOption extends Option {
	public constructor(defaultValue = ".decohere.js") {
		super("--config-file <file>", "Path to Decohere config file");
		this.default(defaultValue);
	}
}

export class RootDirOption extends Option {
	public constructor() {
		super("--root-dir <dir>", "Workspace root (default: the current folder)");
	}
}

export class LogLevelOption extends Option {
	public constructor() {
		super("--log-level <level>", "Log level (trace, debug, info, warn, error)");
	}
}

export class EnvFileOption extends Option {
	public constructor() {
		super("--env-file <file>", "Load environment variables from this file before running");
	}
}

export class EnvFileIfExistsOption extends Option {
	public constructor() {
		super(
			"--env-file-if-exists <file>",
			"Like --env-file, but skip it when the file is missing",
		);
	}
}

export class NoCleanOptions extends Option {
	public constructor(defaultValue: boolean) {
		super("--no-clean", "Will not clean the project directories");
		this.default(defaultValue);
	}
}

export class NoBuildOptions extends Option {
	public constructor(defaultValue: boolean) {
		super("--no-build", "Will not run the build step");
		this.default(defaultValue);
	}
}

export class DryRunOption extends Option {
	public constructor(description: string, defaultValue = false) {
		super("--dry-run [dryRun]", description);
		this.default(defaultValue);
		this.preset(true);
		this.argParser(parseOptionalBoolean);
	}
}

export class ProjectOption extends Option {
	public constructor() {
		super("--project <project>", "Project name to target");
	}
}
