import { type LifetimeScope, LifetimeScopeToken } from "@decohere/crucible";
import { inject, injectable, optional } from "@decohere/crucible/decorators";
import type { Constructable } from "@decohere/core/reflection";
import { scribe } from "@decohere/scribe";
import type { IAuthorizationService } from "../../auth/auth.types.js";
import type { PrincipalProvider } from "../../auth/principal-provider.js";
import {
	AuthorizationServiceToken,
	HttpOptionsToken,
	IPrincipalProviderToken,
	RouteRegistryToken,
} from "../../const.js";
import type { HttpOptions } from "../../http/http.options.js";
import { validateRequest } from "../../openapi/request-validator.js";
import { SseResponse } from "../../sse/sse.types.js";
import type { HttpRequest } from "../anvil.types.js";
import { RoutingError } from "../anvil.types.js";
import { getAuthorizeOptions, isAllowAnonymous } from "../decorators/auth.decorator.js";
import { composeMiddleware, type Middleware } from "../middleware/middleware.js";
import { RouteArgumentResolve } from "./route-argument-resolver.js";
import { RouteRegistry } from "./route-registry.js";

@injectable()
export class Router {
	private readonly argResolver = new RouteArgumentResolve();
	private readonly lifetimeScope: LifetimeScope;
	private readonly routeRegistry: RouteRegistry;
	private readonly authService?: IAuthorizationService;
	private readonly httpOptions?: HttpOptions;
	private readonly logger = scribe.logger(Router.name);

	public constructor(
		@inject(RouteRegistryToken) routeRegistry: RouteRegistry,
		@inject(LifetimeScopeToken) lifetimeScope: LifetimeScope,
		@inject(AuthorizationServiceToken) @optional() authService?: IAuthorizationService,
		@inject(HttpOptionsToken) httpOptions?: HttpOptions,
	) {
		this.routeRegistry = routeRegistry;
		this.lifetimeScope = lifetimeScope;
		this.authService = authService;
		this.httpOptions = httpOptions;
		this.assertAuthConfiguredForProtectedRoutes();
	}

	/**
	 * Without an authorization service nothing checks tokens, so a route marked @Authorize
	 * would be served to anyone. Refuse to start instead of failing open.
	 */
	private assertAuthConfiguredForProtectedRoutes(): void {
		if (this.authService != null) {
			return;
		}
		const protectedRoutes = [...this.routeRegistry.routes]
			.filter(({ controller, handler }) =>
				getAuthorizeOptions(controller.prototype, controller.prototype[handler]),
			)
			.map(({ controller, handler }) => `${controller.name}.${String(handler)}`);
		if (protectedRoutes.length > 0) {
			throw new RoutingError(
				`Routes use @Authorize but auth is not configured, so they would be open to anyone: ${protectedRoutes.join(", ")}. Add .withAuth() to the builder, or remove @Authorize.`,
			);
		}
	}

	public async route(routeKey: string, httpRequest: HttpRequest) {
		const routeConfig = this.routeRegistry.getRoute(routeKey);
		if (!routeConfig) {
			throw new RoutingError(`Route was not configured for key ${routeKey}`);
		}

		const { controller, handler, routeArgs } = routeConfig;
		// Unnamed: the request id comes from the client, so it is not unique.
		// Disposed before we respond, so async cleanup (e.g. rolling back a DB transaction)
		// finishes first. An SSE route is the exception: its scope lives as long as the stream.
		const scope = this.lifetimeScope.beginScope();
		let scopeHandedOff = false;

		// Runs inside the middleware chain so rejections (401/403/400) reach middleware such as
		// the access log. Auth comes first so anonymous callers learn nothing about the body.
		const handle = async () => {
			const principal = await this.authorize(routeConfig, httpRequest);

			if (this.httpOptions?.openapi?.validateRequests !== false && this.httpOptions?.openapi) {
				validateRequest(routeConfig, httpRequest);
			}

			const provider = scope.resolve<PrincipalProvider>(IPrincipalProviderToken);
			provider.setPrincipal(principal);

			const controllerInstance = scope.resolve(controller);
			const func = controllerInstance[handler];
			const argValues = this.argResolver.resolveArguments(httpRequest, routeArgs, provider);
			try {
				const result = await func.apply(controllerInstance, argValues);
				if (routeConfig.sse == null) {
					return result;
				}
				if (typeof result?.[Symbol.asyncIterator] !== "function") {
					throw new RoutingError(
						`${controller.name}.${String(handler)} is marked @Sse() so it must return an AsyncIterable (an async generator method works)`,
					);
				}
				scopeHandedOff = true;
				return new SseResponse(result, () => scope[Symbol.asyncDispose]());
			} catch (error) {
				this.logger.error(error.message, error.stack);
				throw error;
			}
		};

		try {
			const middlewares = this.resolveMiddlewares(scope);
			if (middlewares.length === 0) {
				return await handle();
			}

			return await composeMiddleware(middlewares, handle, {
				request: httpRequest,
				route: routeConfig,
			});
		} catch (error) {
			// A middleware failed after the handler returned: nobody will consume the stream.
			scopeHandedOff = false;
			throw error;
		} finally {
			if (!scopeHandedOff) {
				await scope[Symbol.asyncDispose]();
			}
		}
	}

	private resolveMiddlewares(scope: LifetimeScope): Middleware[] {
		const types = this.httpOptions?.middlewareTypes ?? [];
		return types.map((type) => scope.resolve(type as Constructable<Middleware>));
	}

	private async authorize(
		routeConfig: ReturnType<RouteRegistry["getRoute"]>,
		httpRequest: HttpRequest,
	): Promise<import("../../auth/auth.types.js").Principal | undefined> {
		// Optional DI may resolve as null when auth is not registered.
		if (this.authService == null) {
			return;
		}

		const { controller, handler } = routeConfig;
		const handlerFn = controller.prototype[handler];

		if (isAllowAnonymous(controller.prototype, handlerFn)) {
			return;
		}

		const authOptions = getAuthorizeOptions(controller.prototype, handlerFn);
		if (authOptions === undefined) {
			// Auth is enabled but the route has no @Authorize — require a valid
			// token (fail closed) without checking a specific ability.
			return this.authService.authenticateRequest(httpRequest);
		}

		return this.authService.authorizeRequest(
			httpRequest,
			authOptions.action,
			authOptions.subject,
		);
	}
}
