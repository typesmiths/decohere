/** A script that runs a Decohere tool hands the step back to Decohere, so it isn't the project's own. */
const DECOHERE_TOOL = /\b(forge|flux|decohere)\b/i;

/**
 * The command of a project's own script for a step (`build`, `check`, `dev`), or `undefined`.
 * A project that declares one has a builder of its own (Astro, Vite, Angular), and Decohere's
 * tools run that script in its folder instead of doing the step themselves. A script that calls
 * `forge`, `flux` or `decohere` doesn't count: running it would only call the tool again.
 */
function own(
	scripts: Readonly<Record<string, string>> | undefined,
	name: string,
): string | undefined {
	const command = scripts?.[name];
	if (command == null || command.trim() === "" || DECOHERE_TOOL.test(command))
		return undefined;
	return command;
}

export const projectScripts = { own };
