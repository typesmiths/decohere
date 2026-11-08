// Postgres bootstrap shared by every provider: databases, least-privilege roles and schemas,
// over a plain pg connection. Imports pg, so it is a subpath of its own.
export * from "./bootstrap.js";
