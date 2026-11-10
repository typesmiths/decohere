import type { Command } from "commander";
import { resolveTargetDir } from "../resolve-target-dir.js";
import { parseApiNames } from "./api-name.js";
import { DATABASE_PROVIDERS, parseDatabaseProvider } from "./database-provider.js";
import type { ApiOptions } from "./create-api.js";
import { scaffoldApi } from "./create-api.js";

export function collectName(value: string, previous: string[]): string[] {
	previous.push(value);
	return previous;
}

export function addWebapiFeatureOptions(cmd: Command): Command {
	return cmd
		.option("--database <provider>", `Database provider: ${DATABASE_PROVIDERS.join(" | ")}`)
		.option("--auth <provider>", "Auth provider: none | auth0")
		.option("-y, --yes", "Install dependencies without prompting")
		.option("--install <mode>", "Dependency install mode: ask | yes | no", "ask");
}

export function toApiOptions(
	directory: string | undefined,
	opts: Record<string, unknown>,
	extra: Partial<ApiOptions> = {},
): ApiOptions {
	const installMode = String(opts.install ?? "ask").toLowerCase();
	const names = Array.isArray(opts.name)
		? (opts.name as string[])
		: typeof opts.name === "string"
			? [opts.name]
			: extra.names;
	return {
		d: resolveTargetDir(directory, typeof opts.d === "string" ? opts.d : undefined),
		databaseProvider: parseDatabaseProvider(opts.database),
		authProvider: opts.auth as ApiOptions["authProvider"],
		installDependencies:
			opts.yes === true
				? "yes"
				: installMode === "yes" || installMode === "no"
					? installMode
					: undefined,
		names,
		...extra,
	};
}

export async function runScaffoldApi(normalized: ApiOptions): Promise<void> {
	parseApiNames(normalized.names);
	const { closePrompt } = await import("../domain/prompt.js");
	try {
		await scaffoldApi(normalized);
	} finally {
		closePrompt();
	}
}
