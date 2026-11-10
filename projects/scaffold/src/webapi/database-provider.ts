import { CreateCliError } from "./api-name.js";

/** The `--database` choices. MikroORM is the default ORM for Postgres. */
export const DATABASE_PROVIDERS = ["none", "postgres/mikro-orm", "postgres/typeorm"] as const;

export type DatabaseProvider = (typeof DATABASE_PROVIDERS)[number];

export type Orm = "mikro-orm" | "typeorm";

/** The ORM a choice maps entities with, or `undefined` for no database. */
export function ormOf(provider: DatabaseProvider | undefined): Orm | undefined {
	if (provider === "postgres/mikro-orm") return "mikro-orm";
	if (provider === "postgres/typeorm") return "typeorm";
	return undefined;
}

/** Check a `--database` value, so a typo stops the scaffold rather than leaving out the database. */
export function parseDatabaseProvider(value: unknown): DatabaseProvider | undefined {
	if (value == null) return undefined;
	if ((DATABASE_PROVIDERS as readonly unknown[]).includes(value))
		return value as DatabaseProvider;
	throw new Error(
		`--database must be one of ${DATABASE_PROVIDERS.join(", ")} (got ${JSON.stringify(value)})`,
	);
}

/** Check an `--orm` value. */
export function parseOrm(value: unknown): Orm {
	if (value === "mikro-orm" || value === "typeorm") return value;
	throw new CreateCliError(
		`--orm must be mikro-orm or typeorm (got ${JSON.stringify(value)})`,
	);
}
