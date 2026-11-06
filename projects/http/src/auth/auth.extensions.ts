import type { ContainerBuilder } from "@decohere/crucible";
import { extension } from "@decohere/core/extensibility";
import { Builder } from "@decohere/core/hosting";
import { AuthorizationServiceToken, TokenServiceToken } from "../const.js";
import { defineAbilitiesFor } from "./ability.js";
import { AuthConfig } from "./auth.config.js";
import type { PrincipalMapper, TokenServiceConfig } from "./auth.types.js";
import { assertDevStaticAllowed, assertNonEmptyAudience } from "./auth.types.js";
import type { AbilityFactory } from "./casl-authorization.service.js";
import { CaslAuthorizationService } from "./casl-authorization.service.js";
import { TokenService } from "./token-service.js";

export { ADMIN_ROLE, createPrincipalFromPayload, defineAbilitiesFor } from "./ability.js";

export type WithAuthOptions = {
	/**
	 * Override the default JWT payload → Principal mapping.
	 * Use this when your IdP stores roles or scopes in non-standard claims.
	 *
	 * @example Keycloak realm roles:
	 * ```ts
	 * builder.withAuth(factory, {
	 *   principalMapper: (p) => ({
	 *     sub: p.sub as string,
	 *     scopes: (p.realm_access as any)?.roles?.map((r: string) => `manage:${r}`) ?? [],
	 *   }),
	 * });
	 * ```
	 */
	principalMapper?: PrincipalMapper;
};

declare module "@decohere/core/hosting" {
	interface Builder {
		/**
		 * Configure JWT authentication from the `auth` config section and wire
		 * up a CASL authorization service.
		 *
		 * By default, `defineAbilitiesFor` grants `manage`/`all` for the `admin`
		 * role and maps `principal.scopes` of the form `"action:Subject"` to CASL
		 * rules. Pass a custom `abilityFactory` to override that behaviour.
		 *
		 * Requires `.withConfiguration(...)` to be called on the builder.
		 *
		 * @example Default (scope-based, no boilerplate):
		 * ```ts
		 * builder.withConfiguration(YamlDataSource).withAuth();
		 * ```
		 *
		 * @example Custom override:
		 * ```ts
		 * builder.withAuth((principal) => {
		 *   const { can, build } = new AbilityBuilder(createMongoAbility);
		 *   // custom logic ...
		 *   return build();
		 * });
		 * ```
		 */
		withAuth(abilityFactory?: AbilityFactory, options?: WithAuthOptions): Builder;
	}
}

export class BuilderExtensions {
	@extension(Builder)
	public static withAuth(
		builder: Builder,
		abilityFactory: AbilityFactory = defineAbilitiesFor,
		options?: WithAuthOptions,
	) {
		builder.registerPreBuildStep(async (configService, containerBuilder: ContainerBuilder) => {
			const authConfig = await configService.get(AuthConfig);
			const tokenConfig = toTokenServiceConfig(authConfig);
			const tokenService = new TokenService(tokenConfig, options?.principalMapper);
			containerBuilder.registerSingleton(TokenServiceToken, tokenService);
			containerBuilder.registerSingleton(
				AuthorizationServiceToken,
				new CaslAuthorizationService(abilityFactory, tokenService),
			);
		});
		return builder;
	}
}

function toTokenServiceConfig(config: AuthConfig): TokenServiceConfig {
	// Prefer real verification strategies over devStatic so a leftover
	// development block cannot disable OIDC/JWKS in any environment.
	if (config.discoveryUrl != null) {
		assertNonEmptyAudience(config.audience);
		return { discoveryUrl: config.discoveryUrl, audience: config.audience };
	}
	if (config.jwksUrl != null) {
		assertNonEmptyAudience(config.audience);
		return { jwksUrl: config.jwksUrl, issuer: config.issuer, audience: config.audience };
	}
	if (config.publicKey != null) {
		assertNonEmptyAudience(config.audience);
		return {
			publicKey: config.publicKey,
			algorithms: config.algorithms,
			issuer: config.issuer,
			audience: config.audience,
		};
	}
	if (config.secret != null) {
		assertNonEmptyAudience(config.audience);
		return { secret: config.secret, issuer: config.issuer, audience: config.audience };
	}
	if (config.devStatic != null) {
		assertDevStaticAllowed();
		return { devStatic: config.devStatic };
	}
	throw new Error(
		"AuthConfig must specify one of: discoveryUrl, jwksUrl, publicKey, secret, or devStatic",
	);
}
