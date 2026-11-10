import type { AppServer } from "@decohere/core/hosting";
import type { Constructable, Type } from "@decohere/core/reflection";
import type { HTTPMethod } from "../const.js";
import type { SseOptions } from "../sse/sse.types.js";
import type { Pipe } from "./pipes/pipes.js";
import type { ProblemOptions } from "./problem-details.js";

export type Metadata =
	| "controller"
	| "route"
	| "parameter"
	| "fieldMap"
	| "authorize"
	| "allowAnonymous"
	| "httpCode"
	| "headers"
	| "catch";

export type CorsOptions = {
	origin?: boolean | string | string[];
	methods?: string[];
	allowedHeaders?: string[];
	exposedHeaders?: string[];
	credentials?: boolean;
	maxAge?: number;
};

export const RequestParts = {
	query: "query",
	params: "params",
	body: "body",
	principal: "principal",
	signal: "signal",
	lastEventId: "lastEventId",
} satisfies Record<RequestPart, RequestPart>;

export interface HttpProvider extends AppServer {
	start<T extends StartOptions>(options: T): Promise<StartResponse>;
	stop(): Promise<StopResponse>;
	[Symbol.asyncDispose](): Promise<void>;
}

export type RequestPart = "query" | "params" | "body" | "principal" | "signal" | "lastEventId";

/** Argument locations filled by the HTTP package itself rather than read from the request payload. */
export const InjectedParts: readonly RequestPart[] = ["principal", "signal", "lastEventId"];

export type MappedRoute = {
	key: string;
	controller: Constructable;
	handler: string;
	routeArgs?: RouteArg[];
	httpCode?: number;
	headers?: Record<string, string>;
	/** Set by `@Sse()`: the handler returns a stream of events instead of a single response. */
	sse?: SseOptions;
} & RouteMetadata;

export type RouteArg = {
	argumentType: Constructable;
	fieldMap?: Map<string, FieldMeta>;
	pipes?: Constructable<Pipe>[];
} & ArgumentMeta;

export class HttpRequest {
	public constructor(data?: Partial<HttpRequest>) {
		Object.assign(this, data);
	}
	public requestId = "";
	public url: string;
	public method: string;
	public params: Record<string, string> = {};
	public query: Record<string, string> = {};
	public body: unknown;
	public headers: Record<string, string> = {};
	/** Aborts when the client disconnects or the app stops. Never aborts if the provider cannot tell. */
	public signal: AbortSignal = new AbortController().signal;
	/** Outbound headers set by middleware; applied by the HTTP provider. */
	public responseHeaders: Record<string, string> = {};
}

export type StartResponse = { addresses: string[] };
export type StopResponse = { message: string };
export type StartOptions = { port: number; host?: string };

export type ArgumentMeta = {
	argumentIndex: number;
	mappingKey?: string;
	argumentLocation?: RequestPart;
	pipes: Constructable<Pipe>[];
};

export type ControllerMetadata = {
	prefix: string;
	/**
	 * `false` leaves this controller's routes out of the global prefix (`globalPrefix`), for
	 * paths something outside the app expects at a fixed place: probes, webhooks, metrics. Default
	 * `true`.
	 */
	globalPrefix?: boolean;
};

export type FieldMeta = {
	fieldKey: string;
	fieldType: Type;
	mappingKey: string;
	fieldLocation?: RequestPart;
	pipes?: Constructable<Pipe>[];
};

export type RouteMetadata = {
	path: string;
	method: HTTPMethod;
};
export class RouteConfigurationError extends Error {}
export class RoutingError extends Error {}
export class TransformError extends Error {}

/**
 * An error the API answers with `status`, sent as an RFC 9457 problem whose `detail` is the
 * message. A domain error subclasses it and passes a problem `type`, `title` and extensions.
 */
export class HttpError extends Error {
	public readonly status: number;
	public readonly problem: ProblemOptions;
	public constructor(message: string, status: number, problem: ProblemOptions = {}) {
		super(message);
		this.status = status;
		this.problem = problem;
	}
}

export class UnauthorizedError extends HttpError {
	public constructor(message = "Unauthorized") {
		super(message, 401);
	}
}

export class ForbiddenError extends HttpError {
	public constructor(message = "Forbidden") {
		super(message, 403);
	}
}

export type ValidationIssue = {
	path: string;
	message: string;
	keyword?: string;
};

export class ValidationError extends HttpError {
	public readonly errors: ValidationIssue[];

	public constructor(message = "Bad Request", errors: ValidationIssue[] = []) {
		super(message, 400);
		this.errors = errors;
	}
}
