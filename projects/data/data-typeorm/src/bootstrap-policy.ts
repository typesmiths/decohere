import { type ConnectionInfo, DataConfigurationError } from "@decohere/data";

/** True when NODE_ENV says development. Only then may a data source declare `auth: trust`. */
export function isDevelopmentEnv(nodeEnv: string | undefined = process.env.NODE_ENV): boolean {
	const env = nodeEnv?.toLowerCase() ?? "";
	return env === "development" || env === "dev";
}

function isTrusted(info: ConnectionInfo): boolean {
	return info.auth === "trust";
}

function has(value: string | undefined): boolean {
	return typeof value === "string" && value.length > 0;
}

/**
 * Check how a data source signs in, in every environment. A server that needs no password is
 * declared with `auth: trust`, never inferred from a missing password: a password left out by
 * mistake would otherwise look like a trusted server and fail later, less clearly.
 */
export function assertDataSourceAuth(
	info: ConnectionInfo,
	nodeEnv: string | undefined = process.env.NODE_ENV,
): void {
	const auth = info.auth ?? "password";
	if (auth !== "password" && auth !== "trust") {
		throw new DataConfigurationError(
			`Data source "${info.name}": auth must be "password" or "trust" (got ${JSON.stringify(auth)})`,
		);
	}
	if (auth === "trust") {
		if (!isDevelopmentEnv(nodeEnv)) {
			throw new DataConfigurationError(
				`Data source "${info.name}" sets auth: trust, which is allowed only in development (NODE_ENV is ${JSON.stringify(nodeEnv ?? "")}). A server that trusts every connection belongs on a developer's machine.`,
			);
		}
		return;
	}
	if (!has(info.password)) {
		throw new DataConfigurationError(
			`Data source "${info.name}" has no password. Set password, or auth: trust for a local server that trusts every connection.`,
		);
	}
}

/**
 * Decide whether to bootstrap a data source (create its database, roles and schema).
 *
 * - `bootstrap: false` → never
 * - `bootstrap: true` → yes (requires adminUser, and adminPassword unless `auth: trust`)
 * - omitted → only in development, when those admin credentials are present
 */
export function shouldBootstrapDatabase(
	info: ConnectionInfo,
	nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
	if (info.bootstrap === false) {
		return false;
	}

	const hasAdmin = has(info.adminUser) && (isTrusted(info) || has(info.adminPassword));

	if (info.bootstrap === true) {
		if (!hasAdmin) {
			throw new DataConfigurationError(
				`Data source "${info.name}": bootstrap requires adminUser and adminPassword (adminPassword may be left out only with auth: trust)`,
			);
		}
		return true;
	}

	return isDevelopmentEnv(nodeEnv) && hasAdmin;
}

/** A data source that will be bootstrapped must have every password the bootstrap needs. */
export function assertBootstrapCredentials(info: ConnectionInfo): void {
	if (isTrusted(info)) return;
	if (has(info.migrateUsername) && !has(info.migratePassword)) {
		throw new DataConfigurationError(
			`Data source "${info.name}" has migrateUsername but no migratePassword. Set migratePassword, or auth: trust for a local server that trusts every connection.`,
		);
	}
}
