import { Command, CommanderError } from "commander";
import { runAddAuth0 } from "./webapi/add-auth0.js";
import { CreateCliError } from "./webapi/api-name.js";
import { runAuth0Configure, runAuth0Login, runAuth0Token } from "./webapi/auth0-commands.js";
import {
	addWebapiFeatureOptions,
	collectName,
	runScaffoldApi,
	toApiOptions,
} from "./webapi/cli-options.js";

export function createProgram(): Command {
	const program = new Command();
	program.exitOverride();
	program
		.name("decohere")
		.description("Decohere CLI")
		.option("-d <directory>", "Target directory (default: current directory)", ".");

	const create = program.command("create").description("Create a new Decohere workspace");
	addWebapiFeatureOptions(
		create
			.command("webapi")
			.argument("[directory]", "Target directory (default: -d or current directory)")
			.option(
				"--name <slug>",
				"API name under projects/ (repeatable; default: api)",
				collectName,
				[] as string[],
			),
	).action(async (directory: string | undefined, _opts: unknown, cmd: Command) => {
		await runScaffoldApi(toApiOptions(directory, cmd.optsWithGlobals()));
	});

	const add = program.command("add").description("Add to an existing Decohere workspace");
	add
		.command("auth0")
		.description("Add Auth0 to an existing Decohere workspace")
		.action((_opts: unknown, cmd: Command) => {
			const d = cmd.optsWithGlobals().d;
			runAddAuth0(typeof d === "string" ? d : ".");
		});

	addWebapiFeatureOptions(
		add.command("api").argument("<name>", "API name under projects/"),
	).action(async (name: string, _opts: unknown, cmd: Command) => {
		await runScaffoldApi(
			toApiOptions(undefined, cmd.optsWithGlobals(), { names: [name], add: true }),
		);
	});

	const auth0 = program
		.command("auth0")
		.description("Log in to Auth0 and update a scaffolded client");
	auth0
		.command("login")
		.description("Authenticate the Auth0 CLI (device URL)")
		.action(() => {
			runAuth0Login();
		});
	auth0
		.command("configure")
		.description("Update Auth0 API permissions from @Authorize in this workspace")
		.action((_opts: unknown, cmd: Command) => {
			const d = cmd.optsWithGlobals().d;
			runAuth0Configure(typeof d === "string" ? d : ".");
		});
	auth0
		.command("token")
		.description("Print an access token for calling this workspace's API in development")
		.action((_opts: unknown, cmd: Command) => {
			const d = cmd.optsWithGlobals().d;
			runAuth0Token(typeof d === "string" ? d : ".");
		});

	return program;
}

/**
 * Runs the CLI and returns its exit code; the bin (`cli.ts`) exits with it. Returning instead
 * of calling `process.exit` here lets tests run it in process: a run that finished after its
 * test had timed out used to call `process.exit` in whichever test came next.
 */
export async function runCli(argv: string[] = process.argv): Promise<number> {
	try {
		await createProgram().parseAsync(argv);
	} catch (err) {
		if (err instanceof CommanderError) {
			return err.exitCode;
		}
		if (err instanceof CreateCliError) {
			console.error(`\n  ${err.message}\n`);
			return 1;
		}
		console.error(err);
		return 1;
	}
	return typeof process.exitCode === "number" ? process.exitCode : 0;
}
