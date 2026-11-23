import type { Principal } from "@decohere/http";
import {
	ADMIN_ROLE,
	createPrincipalFromPayload,
	defineAbilitiesFor as defaultDefineAbilitiesFor,
} from "@decohere/http";

/**
 * Customize CASL authorization here (product-specific rules).
 *
 * Default delegates to `@decohere/http`: `admin` role → `manage`/`all`; IdP scopes
 * (`action:Subject`) → abilities. Replace the body when you need app rules
 * beyond that — this file is the intentional extension point, not framework
 * infrastructure to copy.
 */
export function defineAbilitiesFor(principal: Principal) {
	return defaultDefineAbilitiesFor(principal);
}

/**
 * Customize JWT → Principal mapping here (IdP-specific claims).
 *
 * Elevates `AUTH0_ADMIN_USER_SUB` to the admin role so the seeded admin works
 * before/without roles on the access token.
 */
export function mapPrincipal(payload: Record<string, unknown>): Principal {
	const principal = createPrincipalFromPayload(payload);
	const sub = principal.sub;
	if (sub && sub === process.env.AUTH0_ADMIN_USER_SUB) {
		return {
			...principal,
			roles: [...new Set([ADMIN_ROLE, ...(principal.roles ?? [])])],
		};
	}
	return principal;
}
