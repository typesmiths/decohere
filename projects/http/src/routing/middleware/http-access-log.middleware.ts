import { injectable } from "@decohere/crucible/decorators";
import { scribe } from "@decohere/scribe";
import { HttpError } from "../http.types.js";
import type { Middleware, MiddlewareContext } from "./middleware.js";
import { REQUEST_ID_HEADER } from "./request-id.js";

/**
 * Echoes `x-request-id` on the response and writes an HTTP access line via Scribe
 * (method, path, status, durationMs; the request context adds requestId). Enabled by default
 * through `http(...)`.
 */
@injectable()
export class HttpAccessLogMiddleware implements Middleware {
	public async use(ctx: MiddlewareContext, next: () => Promise<unknown>): Promise<unknown> {
		const logger = scribe.logger(HttpAccessLogMiddleware.name);
		const start = performance.now();
		ctx.request.responseHeaders[REQUEST_ID_HEADER] = ctx.request.requestId;

		let status = ctx.route.httpCode ?? 200;
		try {
			return await next();
		} catch (error) {
			status = error instanceof HttpError ? error.status : 500;
			throw error;
		} finally {
			const durationMs = Math.round(performance.now() - start);
			logger.info({
				msg: "access",
				method: ctx.request.method,
				path: ctx.request.url,
				status,
				durationMs,
			});
		}
	}
}
