import {
	createRemoteJWKSet,
	importJWK,
	importSPKI,
	type JWTPayload,
	type JWTVerifyGetKey,
	jwtVerify,
	SignJWT,
} from "jose";
import type { HttpRequest } from "../routing/http.types.js";
import { UnauthorizedError } from "../routing/http.types.js";
import { createPrincipalFromPayload } from "./ability.js";
import type {
	Principal,
	PrincipalMapper,
	PublicKeyConfig,
	SecretConfig,
	TokenServiceConfig,
} from "./auth.types.js";
import {
	assertDevStaticAllowed,
	assertNonEmptyAudience,
	isDevStaticConfig,
	isDiscoveryConfig,
	isJwksConfig,
	isPublicKeyConfig,
	isSecretConfig,
} from "./auth.types.js";
import { assertSafeOutboundUrl } from "./safe-outbound-url.js";

/** Key material + claim checks needed for a single jwtVerify call. */
type VerificationContext = {
	key: JWTVerifyGetKey | Awaited<ReturnType<typeof importJWK>> | Uint8Array;
	issuer?: string;
	audience?: string;
};

export class TokenService {
	private readonly config: TokenServiceConfig;
	private readonly principalMapper?: PrincipalMapper;
	/** Lazily resolved JWKS set when using OIDC discovery. */
	private discoveryJwks?: ReturnType<typeof createRemoteJWKSet>;
	private discoveryIssuer?: string;
	/** Remote key set for `jwksUrl` mode, created once so jose can cache the keys. */
	private configuredJwks?: ReturnType<typeof createRemoteJWKSet>;

	public constructor(config: TokenServiceConfig, principalMapper?: PrincipalMapper) {
		if (isDevStaticConfig(config)) {
			assertDevStaticAllowed();
		} else {
			assertNonEmptyAudience(config.audience);
		}
		this.config = config;
		this.principalMapper = principalMapper;
	}

	public async verifyRequest(request: HttpRequest): Promise<Principal> {
		const authHeader = request.headers.authorization;
		if (!authHeader) {
			throw new UnauthorizedError("Missing Authorization header");
		}
		const spaceIdx = authHeader.indexOf(" ");
		if (spaceIdx === -1) {
			throw new UnauthorizedError("Malformed Authorization header");
		}
		const scheme = authHeader.slice(0, spaceIdx);
		if (scheme !== "Bearer") {
			throw new UnauthorizedError(`Unsupported authorization scheme: ${scheme}`);
		}
		const credentials = authHeader.slice(spaceIdx + 1);
		return this.verify(credentials);
	}

	public async verify(credentials: string): Promise<Principal> {
		if (isDevStaticConfig(this.config)) {
			return this.config.devStatic;
		}

		try {
			const { key, issuer, audience } = await this.resolveVerificationContext();
			// jose's overloads don't accept Key | JWKS-getter as a union; runtime does.
			const { payload } = await jwtVerify(credentials, key as never, { issuer, audience });
			return this.mapPrincipal(payload);
		} catch (err) {
			throw new UnauthorizedError(
				err instanceof Error ? err.message : "Token verification failed",
			);
		}
	}

	/**
	 * Resolve how to verify tokens for the configured strategy:
	 * - OIDC discovery → fetch JWKS + issuer from `/.well-known/openid-configuration`
	 * - explicit JWKS URL → remote key set + configured issuer/audience
	 * - public key / shared secret → static key material + configured issuer/audience
	 */
	private async resolveVerificationContext(): Promise<VerificationContext> {
		if (isDiscoveryConfig(this.config)) {
			const { jwks, issuer } = await this.resolveOidcDiscovery();
			return { key: jwks, issuer, audience: this.config.audience };
		}
		if (isJwksConfig(this.config)) {
			this.configuredJwks ??= createRemoteJWKSet(
				await assertSafeOutboundUrl(this.config.jwksUrl, "jwksUrl"),
			);
			return {
				key: this.configuredJwks,
				issuer: this.config.issuer,
				audience: this.config.audience,
			};
		}
		return {
			key: await this.getStaticKey(),
			issuer: (this.config as PublicKeyConfig | SecretConfig).issuer,
			audience: (this.config as PublicKeyConfig | SecretConfig).audience,
		};
	}

	private async resolveOidcDiscovery(): Promise<{
		jwks: ReturnType<typeof createRemoteJWKSet>;
		issuer: string;
	}> {
		if (this.discoveryJwks && this.discoveryIssuer) {
			return { jwks: this.discoveryJwks, issuer: this.discoveryIssuer };
		}
		const { discoveryUrl } = this.config as import("./auth.types.js").DiscoveryConfig;
		await assertSafeOutboundUrl(discoveryUrl, "discoveryUrl");
		const resp = await fetch(
			`${discoveryUrl.replace(/\/$/, "")}/.well-known/openid-configuration`,
			{
				redirect: "error",
			},
		);
		if (!resp.ok) {
			throw new Error(`OIDC discovery failed for ${discoveryUrl}: HTTP ${resp.status}`);
		}
		const doc = (await resp.json()) as { issuer: string; jwks_uri: string };
		if (typeof doc.jwks_uri !== "string" || doc.jwks_uri.length === 0) {
			throw new Error(`OIDC discovery for ${discoveryUrl} did not return jwks_uri`);
		}
		const jwksUrl = await assertSafeOutboundUrl(doc.jwks_uri, "jwks_uri");
		this.discoveryIssuer = doc.issuer;
		this.discoveryJwks = createRemoteJWKSet(jwksUrl);
		return { jwks: this.discoveryJwks, issuer: this.discoveryIssuer };
	}

	/**
	 * Sign a payload and return a JWT string.
	 * Only available when configured with a SecretConfig (HS256).
	 * For RS256/ES256 issuance, the caller is responsible for key management.
	 */
	public async sign(
		payload: Omit<JWTPayload, "iss" | "aud"> & Record<string, unknown>,
		expiresIn = "1h",
	): Promise<string> {
		if (!isSecretConfig(this.config)) {
			throw new Error("TokenService.sign() requires SecretConfig (shared secret / HS256)");
		}
		const key = new TextEncoder().encode(this.config.secret);
		return new SignJWT(payload)
			.setProtectedHeader({ alg: "HS256" })
			.setIssuedAt()
			.setIssuer(this.config.issuer ?? "")
			.setAudience(this.config.audience ?? "")
			.setExpirationTime(expiresIn)
			.sign(key);
	}

	private async getStaticKey(): Promise<Awaited<ReturnType<typeof importJWK>> | Uint8Array> {
		if (isPublicKeyConfig(this.config)) {
			const cfg = this.config as PublicKeyConfig;
			const trimmed = cfg.publicKey.trim();
			if (trimmed.startsWith("{")) {
				const jwk = JSON.parse(trimmed) as Parameters<typeof importJWK>[0];
				return importJWK(jwk);
			}
			return importSPKI(trimmed, cfg.algorithms?.[0] ?? "RS256");
		}

		if (isSecretConfig(this.config)) {
			const enc = new TextEncoder().encode((this.config as SecretConfig).secret);
			return enc;
		}

		throw new Error("Invalid TokenService configuration");
	}

	private mapPrincipal(payload: JWTPayload): Principal {
		if (this.principalMapper) return this.principalMapper(payload as Record<string, unknown>);
		return createPrincipalFromPayload(payload as Record<string, unknown>);
	}
}
