import { AbilityBuilder, createMongoAbility } from "@casl/ability";
import type { Principal } from "./auth.types.js";

/** Root role — expands to CASL `manage`/`all` (covers every future ability). */
export const ADMIN_ROLE = "admin";

/**
 * Default CASL ability factory.
 *
 * - `admin` role → `manage` / `all` (wildcard)
 * - otherwise map `principal.scopes` of the form `"action:Subject"` to CASL rules
 *
 * Pass a custom factory to `auth()` (or override the app stub) for product-specific rules.
 */
export function defineAbilitiesFor(principal: Principal) {
	const { can, build } = new AbilityBuilder(createMongoAbility);
	if (principal.roles?.includes(ADMIN_ROLE)) {
		can("manage", "all");
		return build();
	}
	for (const scope of principal.scopes ?? []) {
		const [action, subject] = scope.split(":");
		if (action && subject) can(action, subject);
	}
	return build();
}

/**
 * Map a raw JWT payload → {@link Principal}.
 *
 * Merges OAuth `scope` / `scopes` with an IdP `permissions` claim (e.g. Auth0 API permissions).
 * Override via `auth(..., { principalMapper })` when claims differ.
 */
export function createPrincipalFromPayload(payload: Record<string, unknown>): Principal {
	const sub = typeof payload.sub === "string" ? payload.sub : "";
	const fromScopeClaim =
		typeof payload.scope === "string"
			? payload.scope.split(" ").filter(Boolean)
			: Array.isArray(payload.scopes)
				? (payload.scopes as unknown[]).filter((s): s is string => typeof s === "string")
				: [];
	const fromPermissions = Array.isArray(payload.permissions)
		? (payload.permissions as unknown[]).filter((s): s is string => typeof s === "string")
		: [];
	const merged = [...new Set([...fromScopeClaim, ...fromPermissions])];
	const scopes = merged.length > 0 ? merged : undefined;
	const roles = Array.isArray(payload.roles)
		? (payload.roles as unknown[]).filter((r): r is string => typeof r === "string")
		: undefined;
	return {
		...payload,
		sub,
		roles: roles && roles.length > 0 ? roles : undefined,
		scopes,
	};
}
