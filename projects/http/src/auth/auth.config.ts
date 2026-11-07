import type { Principal } from "./auth.types.js";

/**
 * Configuration for the TokenService, read from the `auth` section of the
 * application config file. Exactly one of the discriminant fields must be set.
 *
 * Production  → use `jwksUrl`, `publicKey`, or `secret`.
 * Development → use `devStatic` (only works when NODE_ENV=development).
 */
export class AuthConfig {
	public static schema = {
		type: "object",
		properties: { devStatic: { devOnly: true } },
	};

	/** OIDC discovery URL — the issuer base URL, e.g. https://accounts.google.com.
	 *  The framework appends `/.well-known/openid-configuration` automatically.
	 *  Use this instead of `jwksUrl` for any standard OIDC-compliant IdP.
	 */
	public discoveryUrl?: string;

	/** JWKS endpoint URL (RS256 / ES256 via remote key set). */
	public jwksUrl?: string;

	/** PEM-encoded public key or JWK JSON string (RS256 / ES256 static key). */
	public publicKey?: string;
	public algorithms?: string[];

	/** Shared secret for HS256. */
	public secret?: string;

	/** Issuer claim to validate (all non-devStatic variants). */
	public issuer?: string;
	/** Audience claim to validate (all non-devStatic variants). */
	public audience?: string;

	/** Static principal injected for every request (development only). */
	public devStatic?: Principal;
}
