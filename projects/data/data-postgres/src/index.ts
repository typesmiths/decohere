// Everything Postgres-only in Decohere's data layer. Today: creating a data source's database,
// least-privilege roles and schema at startup, which a provider runs when it is passed
// `bootstrap: postgres.bootstrap`.
import { bootstrapDataSources } from "./bootstrap.js";

export * from "./bootstrap.js";

export const postgres = { bootstrap: bootstrapDataSources };
