import { type LifetimeScope, LifetimeScopeToken } from "@decohere/crucible";
import { inject, injectable } from "@decohere/crucible/decorators";
import type { Constructable } from "@decohere/core/reflection";
import { scribe } from "@decohere/scribe";
import { HttpOptionsToken } from "../../const.js";
import type { HttpOptions } from "../../http/http.options.js";
import { HttpError, ValidationError } from "../http.types.js";
import { type ProblemDetails, problemDetails } from "../problem-details.js";
import {
	type ExceptionContext,
	type ExceptionFilter,
	type ExceptionResult,
	getCatchTypes,
} from "./exception-filter.js";

@injectable()
export class DefaultHttpExceptionFilter implements ExceptionFilter {
	private readonly logger = scribe.logger(DefaultHttpExceptionFilter.name);

	/** Every answer is an RFC 9457 problem (`application/problem+json`). */
	public catch(error: unknown, _ctx: ExceptionContext): ExceptionResult {
		return problemDetails.toResult(this.toProblem(error));
	}

	private toProblem(error: unknown): ProblemDetails {
		if (error instanceof ValidationError) {
			return problemDetails.create(400, {
				...error.problem,
				detail: error.message,
				extensions: { ...error.problem.extensions, errors: error.errors },
			});
		}
		if (error instanceof HttpError) {
			// Never expose internal auth failure details (header shape, issuer, etc.) to clients.
			if (error.status === 401) {
				this.logger.warn(error.message);
				return problemDetails.create(401);
			}
			// Sanitize only true 500s. Keep intentional 503 probe messages (e.g. /ready).
			if (error.status === 500) {
				this.logger.error(error.message);
				return problemDetails.create(500);
			}
			return problemDetails.create(error.status, { ...error.problem, detail: error.message });
		}
		if (error instanceof Error) {
			this.logger.error(error.message, error.stack);
		}
		return problemDetails.create(500);
	}
}

/**
 * Resolves the first matching filter for an error.
 * Custom filters (registered via builder) are tried first; default is last.
 */
@injectable()
export class ExceptionFilterHost {
	private filters?: ExceptionFilter[];

	public constructor(
		@inject(HttpOptionsToken) private readonly options?: HttpOptions,
		@inject(LifetimeScopeToken) private readonly scope?: LifetimeScope,
	) {}

	public async handle(error: unknown, ctx: ExceptionContext): Promise<ExceptionResult> {
		for (const filter of this.getFilters()) {
			const filterType = filter.constructor as Constructable;
			const types = getCatchTypes(filterType);
			if (types.length === 0 || types.some((t) => error instanceof t)) {
				return await filter.catch(error, ctx);
			}
		}
		return new DefaultHttpExceptionFilter().catch(error, ctx);
	}

	private getFilters(): ExceptionFilter[] {
		if (this.filters != null) {
			return this.filters;
		}
		const custom =
			this.options?.filterTypes.map((type) => {
				if (this.scope == null) {
					return new (type as Constructable<ExceptionFilter>)();
				}
				return this.scope.resolve<ExceptionFilter>(type);
			}) ?? [];
		this.filters = [...custom, new DefaultHttpExceptionFilter()];
		return this.filters;
	}
}
