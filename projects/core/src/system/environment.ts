export type Environment = "production" | "development";
export const Environments = {
	production: "production",
	development: "development",
} satisfies Record<string, Environment>;
export const DefaultEnvironment = Environments.development;
