import { STATUS_CODES } from "node:http";
import type { ExceptionResult } from "./filters/exception-filter.js";

/** The media type of an RFC 9457 error body. */
export const PROBLEM_CONTENT_TYPE = "application/problem+json";

/**
 * An RFC 9457 error body. `type` identifies the kind of problem (`about:blank` when the status
 * says it all), `title` names it, `detail` explains this occurrence. Any other member is an
 * extension, such as `errors` on a validation problem.
 */
export type ProblemDetails = {
	type: string;
	title: string;
	status: number;
	detail?: string;
	instance?: string;
	[member: string]: unknown;
};

/** What a domain error adds to its problem; `HttpError` takes these as its third argument. */
export type ProblemOptions = {
	/** A URI naming the kind of problem, e.g. `https://shop.example/problems/out-of-stock`. */
	type?: string;
	/** A short name for the kind of problem; defaults to the status text. */
	title?: string;
	/** Extra members, e.g. `{ sku }`. They can't replace the standard members. */
	extensions?: Record<string, unknown>;
};

/**
 * Builds a problem for a status. A `detail` that only repeats the title is left out.
 */
function create(
	status: number,
	options: ProblemOptions & { detail?: string; instance?: string } = {},
): ProblemDetails {
	const title = options.title ?? STATUS_CODES[status] ?? "Error";
	const problem: ProblemDetails = {
		...options.extensions,
		type: options.type ?? "about:blank",
		title,
		status,
	};
	if (options.detail != null && options.detail !== "" && options.detail !== title) {
		problem.detail = options.detail;
	}
	if (options.instance != null) {
		problem.instance = options.instance;
	}
	return problem;
}

/** Wraps a problem as an exception filter's result, with the problem+json content type. */
function toResult(problem: ProblemDetails): ExceptionResult {
	return {
		status: problem.status,
		body: problem,
		headers: { "content-type": PROBLEM_CONTENT_TYPE },
	};
}

export const problemDetails = { create, toResult };
