import type { HttpRequest, MappedRoute } from "../anvil.types.js";

export type MiddlewareContext = {
	request: HttpRequest;
	route: MappedRoute;
};

export interface Middleware {
	use(ctx: MiddlewareContext, next: () => Promise<unknown>): Promise<unknown>;
}

/** Compose middleware around a terminal handler; returns the handler result. */
export function composeMiddleware(
	middlewares: Middleware[],
	handler: () => Promise<unknown>,
	ctx: MiddlewareContext,
): Promise<unknown> {
	const dispatch = (index: number): Promise<unknown> => {
		if (index >= middlewares.length) {
			return handler();
		}
		const middleware = middlewares[index];
		return middleware.use(ctx, () => dispatch(index + 1));
	};
	return dispatch(0);
}
