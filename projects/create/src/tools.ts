/** Set by Decohere's Dev Container image, and by the images built from it. */
const TOOLS_ENV = "DECOHERE_TOOLS";

/** Whether this process runs somewhere that already has Decohere's scaffolding tools. */
export function hasDecohereTools(env: NodeJS.ProcessEnv = process.env): boolean {
	return env[TOOLS_ENV] === "1";
}

export const OPEN_DEV_CONTAINER_MESSAGE =
	"\n  This command runs inside the project's Dev Container, which has the tools it needs.\n" +
	"  Open the project in its Dev Container, then run it there, for example:\n\n" +
	"    pnpm decohere add auth0\n";
