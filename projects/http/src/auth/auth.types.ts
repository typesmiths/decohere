export type Principal = {
	sub: string;
	roles?: string[];
	scopes?: string[];
	[key: string]: unknown;
};

/** Maps a raw JWT payload to a Principal. Override the default via auth() options. */
export type PrincipalMapper = (payload: Record<string, unknown>) => Principal;

export type JwksConfig = {
	jwksUrl: string;
	issuer?: string;
	/** Required — empty/undefined disables jose `aud` checks (cross-API token accept). */
	audience: string;
};

export type PublicKeyConfig = {
	publicKey: string; // PEM or JWK JSON string
	algorithms?: string[];
	issuer?: string;
	/** Required — empty/undefined disables jose `aud` checks (cross-API token accept). */
	audience: string;
};

export type SecretConfig = {
	secret: string;
	issuer?: string;
	/** Required — empty/undefined disables jose `aud` checks (cross-API token accept). */
	audience: string;
};

export type DevStaticConfig = {
	devStatic: Principal;
};

/**
 * Resolve IdP configuration automatically from an OIDC discovery endpoint
 * (`{discoveryUrl}/.well-known/openid-configuration`). The `discoveryUrl` is
 * also used as the expected `iss` claim unless the discovery document provides
 * a different value.
 */
export type DiscoveryConfig = {
	discoveryUrl: string;
	/** Required — empty/undefined disables jose `aud` checks (cross-API token accept). */
	audience: string;
};

/**
 * Framework-agnostic authorization service. Implement this interface (e.g.
 * via CaslAuthorizationService) and register it under AuthorizationServiceToken.
 * Throw ForbiddenError to deny access.
 */
export interface IAuthorizationService {
	authorizeRequest(
		request: import("../routing/http.types.js").HttpRequest,
		action: string,
		subject: string,
	): Promise<Principal>;
	/**
	 * Verify the request has a valid principal without checking a CASL ability.
	 * Used when auth is enabled but the route has no `@Authorize` metadata.
	 */
	authenticateRequest(
		request: import("../routing/http.types.js").HttpRequest,
	): Promise<Principal>;
	authorize(principal: Principal, action: string, subject: string): Promise<void>;
}

export type TokenServiceConfig =
	JwksConfig | PublicKeyConfig | SecretConfig | DevStaticConfig | DiscoveryConfig;

export function isDiscoveryConfig(config: TokenServiceConfig): config is DiscoveryConfig {
	return "discoveryUrl" in config;
}

export function isDevStaticConfig(config: TokenServiceConfig): config is DevStaticConfig {
	return "devStatic" in config;
}

export function isJwksConfig(config: TokenServiceConfig): config is JwksConfig {
	return "jwksUrl" in config;
}

export function isPublicKeyConfig(config: TokenServiceConfig): config is PublicKeyConfig {
	return "publicKey" in config;
}

export function isSecretConfig(config: TokenServiceConfig): config is SecretConfig {
	return "secret" in config;
}

/** `devStatic` is only valid for local development NODE_ENV values. */
export function isDevelopmentNodeEnv(nodeEnv = process.env.NODE_ENV): boolean {
	const env = nodeEnv?.toLowerCase();
	return env === "development" || env === "dev";
}

/**
 * Refuse `devStatic` outside development — otherwise any Bearer string is
 * accepted as the configured principal (auth bypass in production).
 */
export function assertDevStaticAllowed(nodeEnv = process.env.NODE_ENV): void {
	if (!isDevelopmentNodeEnv(nodeEnv)) {
		throw new Error(
			`AuthConfig.devStatic is only allowed when NODE_ENV is "development" or "dev" (got ${JSON.stringify(nodeEnv ?? "")}).`,
		);
	}
}

/**
 * jose skips `aud` validation when `audience` is undefined or "". Require a
 * non-empty audience for every non-devStatic verification strategy.
 */
export function assertNonEmptyAudience(
	audience: string | undefined,
): asserts audience is string {
	if (typeof audience !== "string" || audience.trim().length === 0) {
		throw new Error(
			`JWT audience must be a non-empty string (got ${JSON.stringify(audience)}). ` +
				"Empty audience disables aud validation and accepts tokens minted for other APIs.",
		);
	}
}
