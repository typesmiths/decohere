export type Environment = "production" | "development";
export const Environments = {
	production: "production",
	development: "development",
} satisfies Record<string, Environment>;
export const DefaultEnvironment = Environments.development;

/**
 * True only when NODE_ENV says development: `development` or `dev`. Anything else, unset, staging or
 * a typo included, isn't. Use it to refuse settings that are unsafe outside development.
 */
export function isDevelopmentEnv(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
	const env = nodeEnv?.toLowerCase();
	return env === "development" || env === "dev";
}
