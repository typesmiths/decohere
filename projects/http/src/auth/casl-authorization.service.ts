import type { AnyAbility } from "@casl/ability";
import type { HttpRequest } from "../routing/http.types.js";
import { ForbiddenError } from "../routing/http.types.js";
import type { IAuthorizationService, Principal } from "./auth.types.js";
import type { TokenService } from "./token-service.js";

export type AbilityFactory = (principal: Principal) => AnyAbility;

/**
 * IAuthorizationService implementation backed by CASL.
 *
 * Register it under AuthorizationServiceToken:
 * ```ts
 * builder.withServices((c) =>
 *   c.registerSingleton(AuthorizationServiceToken, new CaslAuthorizationService((principal) => {
 *     const { can, build } = new AbilityBuilder(createMongoAbility);
 *     if (principal.roles?.includes("admin")) can("manage", "all");
 *     else can("read", "Post");
 *     return build();
 *   }))
 * );
 * ```
 */
export class CaslAuthorizationService implements IAuthorizationService {
	private readonly factory: AbilityFactory;
	private readonly tokenService?: TokenService;

	public constructor(factory: AbilityFactory, tokenService?: TokenService) {
		this.factory = factory;
		this.tokenService = tokenService;
	}

	public async authorizeRequest(
		request: HttpRequest,
		action: string,
		subject: string,
	): Promise<Principal> {
		const principal = await this.authenticateRequest(request);
		await this.authorize(principal, action, subject);
		return principal;
	}

	public async authenticateRequest(request: HttpRequest): Promise<Principal> {
		if (!this.tokenService) {
			throw new Error(
				"CaslAuthorizationService requires a TokenService to authenticate requests. Register it via .withAuth().",
			);
		}
		return this.tokenService.verifyRequest(request);
	}

	public async authorize(
		principal: Principal,
		action: string,
		subject: string,
	): Promise<void> {
		const ability = this.factory(principal);
		if (ability.cannot(action, subject)) {
			throw new ForbiddenError(`Cannot perform "${action}" on "${subject}"`);
		}
	}
}
