import type { Dialect, Provider } from "@decohere/data";
import type { DatabaseType } from "typeorm";

export const ProviderMap = {
	postgres: "postgres",
	mssql: "mssql",
} satisfies Record<Provider, DatabaseType>;

export const DialectMap = {
	postgresql: "postgres",
	tsql: "mssql",
} satisfies Record<Dialect, DatabaseType>;
