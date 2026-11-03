export type ShellResponse = {
	message: string;
	data: string[];
};
export interface ShellOptions {
	cwd?: string;
	/** Spawn env. Defaults to `process.env`. Not written to logs. */
	env?: NodeJS.ProcessEnv;
}
