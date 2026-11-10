import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { inject } from "@decohere/crucible/decorators";
import { scribe } from "@decohere/scribe";
import compress from "@fastify/compress";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, {
	type FastifyInstance,
	type FastifyReply,
	type FastifyRequest,
} from "fastify";
import {
	ExceptionFilterHostToken,
	HttpOptionsToken,
	RouteRegistryToken,
	RouterToken,
} from "../const.js";
import type { HttpOptions } from "../http/http.options.js";
import {
	DEFAULT_HTTP_BODY_LIMIT,
	DEFAULT_HTTP_RATE_LIMIT,
	type HelmetOptions,
	type RateLimitOptions,
} from "../http/http.security.js";
import {
	type CompressionOptions,
	DEFAULT_COMPRESSION_ENCODINGS,
	DEFAULT_COMPRESSION_THRESHOLD,
} from "../http/http.compression.js";
import { type ResolvedStaticMount, staticFiles } from "../http/http.static.js";
import { generateOpenApiDocument, resolveOpenApiPath } from "../openapi/openapi.generator.js";
import {
	type CorsOptions,
	type HttpProvider,
	HttpRequest,
	type MappedRoute,
	type StartOptions,
	type StartResponse,
	type StopResponse,
} from "../routing/http.types.js";
import {
	DefaultHttpExceptionFilter,
	type ExceptionFilterHost,
} from "../routing/filters/exception-filter-host.js";
import { REQUEST_ID_HEADER, resolveRequestId } from "../routing/middleware/request-id.js";
import { normalizePrefix } from "../routing/path.util.js";
import { PROBLEM_CONTENT_TYPE, problemDetails } from "../routing/problem-details.js";
import type { RouteRegistry } from "../routing/services/route-registry.js";
import type { Router } from "../routing/services/router.js";
import { encodeSse } from "../sse/sse.encoder.js";
import { DEFAULT_SSE_HEARTBEAT_MS, SseResponse } from "../sse/sse.types.js";

export class FastifyProvider implements HttpProvider {
	public readonly provider: FastifyInstance;
	public readonly router: Router;
	private readonly routeRegistry: RouteRegistry;
	private readonly httpOptions?: HttpOptions;
	private readonly exceptionFilterHost?: ExceptionFilterHost;
	private closing: Promise<void> | undefined;
	private readonly logger = scribe.logger(FastifyProvider.name);
	/** One per live `@Sse()` request, so stopping the app can end the streams. */
	private readonly openStreams = new Set<AbortController>();

	public constructor(
		@inject(RouteRegistryToken) routeRegistry?: RouteRegistry,
		@inject(RouterToken) router?: Router,
		@inject(HttpOptionsToken) httpOptions?: HttpOptions,
		@inject(ExceptionFilterHostToken) exceptionFilterHost?: ExceptionFilterHost,
	) {
		this.routeRegistry = routeRegistry;
		this.router = router;
		this.httpOptions = httpOptions;
		this.exceptionFilterHost = exceptionFilterHost;
		this.provider = Fastify({
			logger: false,
			requestIdHeader: REQUEST_ID_HEADER,
			genReqId: () => randomUUID(),
			bodyLimit: httpOptions?.bodyLimit ?? DEFAULT_HTTP_BODY_LIMIT,
		});
	}

	public async start<T extends StartOptions>(options?: T): Promise<StartResponse> {
		const statics = await this.resolveStatics();
		await this.registerHelmet(this.httpOptions?.helmet);
		await this.registerRateLimit(this.httpOptions?.rateLimit, statics);
		await this.registerCors(this.httpOptions?.cors);
		await this.registerCompression(this.httpOptions?.compression);
		this.registerProblemReplies(statics);
		this.registerOpenApi(this.httpOptions);
		this.registerAllRoutes(this.routeRegistry);
		for (const mount of statics) {
			await this.registerStatic(mount, statics);
		}
		this.closeConnectionsWhileStopping();
		await this.provider.listen(options);
		return {
			addresses: this.addresses,
		};
	}

	public async stop(): Promise<StopResponse> {
		// App stops HTTP before disposing the container, which calls this again.
		// A stream never finishes on its own, and close() waits for open responses, so end them first.
		for (const stream of this.openStreams) {
			stream.abort(new Error("The app is stopping"));
		}
		this.closing ??= this.provider.close();
		await this.closing;
		return { message: "closed" };
	}

	public async [Symbol.asyncDispose](): Promise<void> {
		await this.stop();
	}

	/**
	 * Once stopping, tell clients to drop the connection after their response. Otherwise
	 * a request that was in flight leaves a kept-alive socket that holds `close()` open
	 * until Node's keep-alive timeout (5s).
	 */
	private closeConnectionsWhileStopping() {
		this.provider.addHook("onSend", async (_request, reply, payload) => {
			if (this.closing) reply.header("connection", "close");
			return payload;
		});
	}

	public get addresses() {
		return this.provider
			.addresses()
			.filter((a): a is AddressInfo => typeof a !== "string" && a.family === "IPv4")
			.map((a) => `http://${a.address}:${a.port}`);
	}

	private async registerHelmet(helmetOptions?: HelmetOptions) {
		if (helmetOptions === false) {
			return;
		}
		await this.provider.register(helmet, helmetOptions ?? {});
	}

	private async registerRateLimit(
		rateLimitOptions: RateLimitOptions | undefined,
		statics: readonly ResolvedStaticMount[],
	) {
		if (rateLimitOptions === false) {
			return;
		}
		// Static files are outside the rate limit (ADR 0007). Matched on the route the request
		// resolved to, not on its URL, so only requests the static plugin serves are exempt.
		const staticRoutes = new Set(statics.map((mount) => `${mount.prefix}*`));
		const userAllowList = rateLimitOptions?.allowList;
		await this.provider.register(rateLimit, {
			...DEFAULT_HTTP_RATE_LIMIT,
			...rateLimitOptions,
			allowList: (request: FastifyRequest, key: string) => {
				if (staticRoutes.has(request.routeOptions.url ?? "")) return true;
				if (typeof userAllowList === "function") return userAllowList(request, key);
				return Array.isArray(userAllowList) && userAllowList.includes(key);
			},
		});
	}

	private async resolveStatics(): Promise<ResolvedStaticMount[]> {
		return staticFiles.resolve(this.httpOptions?.statics ?? [], {
			nodeEnv: process.env.NODE_ENV,
			directoryExists: async (directory) =>
				(await stat(directory).catch(() => undefined))?.isDirectory() === true,
			warn: (message) => this.logger.warn(message),
		});
	}

	/**
	 * One encapsulated context per mount: its not-found handler (the SPA fallback) applies to
	 * paths under the prefix and nowhere else, so an API 404 is never answered with the UI.
	 */
	private async registerStatic(
		mount: ResolvedStaticMount,
		mounts: readonly ResolvedStaticMount[],
	) {
		const withoutSlash = mount.prefix.slice(0, -1);
		const isRoot = mount.prefix === "/";
		const excluded = staticFiles.excluder(mount.exclude);
		const belongsToApi = this.apiBoundary();
		// Requests that already fell back once: a missing index must be a 404, not a loop.
		const fellBack = new WeakSet<FastifyRequest>();
		await this.provider.register(
			async (scope) => {
				await scope.register(fastifyStatic, {
					root: mount.root,
					prefix: "/",
					index: mount.index,
					dotfiles: "ignore",
					list: false,
					redirect: false,
					etag: true,
					lastModified: true,
					// The header is set in setHeaders, per file.
					cacheControl: false,
					setHeaders: (reply, filePath) => {
						reply.header(
							"cache-control",
							staticFiles.cacheControlFor(mount, path.relative(mount.root, filePath)),
						);
					},
				});
				// Excluded paths are not served at all: not as a file, not as the fallback.
				scope.addHook("onRequest", async (request, reply) => {
					if (excluded(staticFiles.normalizePathname(request.url))) {
						return reply.callNotFound();
					}
				});
				scope.setNotFoundHandler((request, reply) => {
					const [pathname = "", query] = request.url.split("?");
					const readOnly = request.method === "GET" || request.method === "HEAD";
					// `/ui` goes to `/ui/`. A request for it reaches the root mount's handler instead
					// when there is one, so that handler redirects for the other mounts too.
					const redirectTo = mounts.find(
						(other) =>
							other.prefix !== "/" &&
							other.prefix.slice(0, -1) === pathname &&
							(isRoot || other === mount),
					);
					if (readOnly && redirectTo != null) {
						return reply.redirect(
							query == null ? redirectTo.prefix : `${redirectTo.prefix}?${query}`,
							301,
						);
					}
					const normalized = staticFiles.normalizePathname(request.url);
					if (
						mount.spaFallback &&
						!fellBack.has(request) &&
						!excluded(normalized) &&
						staticFiles.shouldFallBack(
							{ method: request.method, pathname: normalized, accept: request.headers.accept },
							belongsToApi,
						)
					) {
						fellBack.add(request);
						return reply.sendFile(mount.index);
					}
					return this.sendRouteNotFound(request, reply);
				});
			},
			{ prefix: withoutSlash },
		);
	}

	/**
	 * Fastify's own replies, for an unknown route or a request it rejects before any handler
	 * (a body that isn't valid JSON, too large, the rate limit), are problems like the API's.
	 */
	private registerProblemReplies(statics: ResolvedStaticMount[]) {
		// A UI served from the root owns the root's not-found handler, and answers the same 404.
		if (!statics.some((mount) => mount.prefix === "/")) {
			this.provider.setNotFoundHandler((request, reply) =>
				this.sendRouteNotFound(request, reply),
			);
		}
		this.provider.setErrorHandler((error: unknown, _request, reply) => {
			const status = this.getErrorStatus(error);
			const message = error instanceof Error ? error.message : undefined;
			if (status >= 500) {
				this.logger.error(
					message ?? "Request failed",
					error instanceof Error ? error.stack : undefined,
				);
			}
			const problem = problemDetails.create(status, {
				detail: status >= 500 ? undefined : message,
			});
			return reply.status(status).header("content-type", PROBLEM_CONTENT_TYPE).send(problem);
		});
	}

	private getErrorStatus(error: unknown): number {
		const status = (error as { statusCode?: unknown } | null)?.statusCode;
		return typeof status === "number" && status >= 400 && status < 600 ? status : 500;
	}

	private sendRouteNotFound(request: FastifyRequest, reply: FastifyReply) {
		const [pathname = ""] = request.url.split("?");
		const problem = problemDetails.create(404, {
			detail: `Route ${request.method}:${pathname} not found`,
		});
		return reply.code(404).header("content-type", PROBLEM_CONTENT_TYPE).send(problem);
	}

	/** What the static fallback leaves to the API: the global prefix, else the registered routes. ADR 0007. */
	private apiBoundary(): (pathname: string) => boolean {
		return staticFiles.apiBoundary({
			globalPrefix: normalizePrefix(this.httpOptions?.globalPrefix),
			openApiPath:
				this.httpOptions?.openapi == null
					? undefined
					: resolveOpenApiPath(this.httpOptions.openapi),
			routePaths: [...this.routeRegistry.routes].map((route) => route.path),
		});
	}

	/**
	 * `@fastify/compress` with best-practice defaults; the plugin owns the policy. Registered
	 * before any route so every response goes through it, errors and static files included.
	 * `providerOptions` is merged last, so a user can override any plugin option.
	 */
	private async registerCompression(compressionOptions: CompressionOptions | undefined) {
		if (compressionOptions === false) {
			return;
		}
		await this.provider.register(compress, {
			global: true,
			threshold: compressionOptions?.threshold ?? DEFAULT_COMPRESSION_THRESHOLD,
			encodings: [...(compressionOptions?.encodings ?? DEFAULT_COMPRESSION_ENCODINGS)],
			...(compressionOptions?.types != null && { customTypes: compressionOptions.types }),
			...compressionOptions?.providerOptions,
		});
	}

	private async registerCors(corsOptions?: CorsOptions) {
		if (corsOptions == null) {
			return;
		}
		await this.provider.register(cors, {
			origin: corsOptions.origin,
			methods: corsOptions.methods,
			allowedHeaders: corsOptions.allowedHeaders,
			exposedHeaders: corsOptions.exposedHeaders,
			credentials: corsOptions.credentials,
			maxAge: corsOptions.maxAge,
		});
	}

	private registerOpenApi(httpOptions?: HttpOptions) {
		const openapi = httpOptions?.openapi;
		if (openapi == null) {
			return;
		}
		const path = resolveOpenApiPath(openapi);
		const document = generateOpenApiDocument(this.routeRegistry, openapi);
		this.provider.get(path, async (_request, reply) => {
			reply.header("content-type", "application/json; charset=utf-8");
			return document;
		});
	}

	private registerAllRoutes(registry: RouteRegistry) {
		for (const route of registry.routes) {
			const { key, method, path } = route;
			this.provider.route({
				method,
				url: path,
				handler: (request, reply) => this.routeRequest(route, key, request, reply),
			});
		}
	}

	private async routeRequest(
		route: MappedRoute,
		key: string,
		request: FastifyRequest,
		reply: FastifyReply,
	) {
		const httpRequest = this.fastifyToRequest(request);
		const disconnect = this.abortOnDisconnect(reply, httpRequest, route.sse != null);
		try {
			const response = await this.router.route(key, httpRequest);
			if (route.httpCode != null) {
				reply.status(route.httpCode);
			}
			if (route.headers != null) {
				for (const [name, value] of Object.entries(route.headers)) {
					reply.header(name, value);
				}
			}
			this.applyResponseHeaders(reply, httpRequest);
			if (response instanceof SseResponse) {
				return this.sendEventStream(route, reply, response, disconnect);
			}
			return response;
		} catch (error) {
			const result = this.exceptionFilterHost
				? await this.exceptionFilterHost.handle(error, { request: httpRequest })
				: new DefaultHttpExceptionFilter().catch(error, { request: httpRequest });
			if (result.headers) {
				for (const [name, value] of Object.entries(result.headers)) {
					reply.header(name, value);
				}
			}
			this.applyResponseHeaders(reply, httpRequest);
			// Returned so Fastify waits for the async onSend hooks instead of sending an empty reply of its own.
			return reply.status(result.status).send(result.body);
		}
	}

	/**
	 * Gives the handler a signal that aborts when the client goes away before the response
	 * finished. Streams are also tracked so that stopping the app can abort them.
	 */
	private abortOnDisconnect(
		reply: FastifyReply,
		httpRequest: HttpRequest,
		isStream: boolean,
	): AbortController {
		const controller = new AbortController();
		httpRequest.signal = controller.signal;
		if (isStream) {
			if (this.closing) controller.abort(new Error("The app is stopping"));
			this.openStreams.add(controller);
		}
		reply.raw.once("close", () => {
			this.openStreams.delete(controller);
			if (!reply.raw.writableFinished) {
				controller.abort(new Error("The client disconnected"));
			}
		});
		return controller;
	}

	private sendEventStream(
		route: MappedRoute,
		reply: FastifyReply,
		response: SseResponse,
		disconnect: AbortController,
	) {
		let started = false;
		const release = () => {
			response.release().catch((error: unknown) => {
				this.logger.error("Releasing the request scope of an SSE stream failed", error);
			});
		};
		const frames = encodeSse(response.events, {
			signal: disconnect.signal,
			heartbeatMs: route.sse?.heartbeatMs ?? DEFAULT_SSE_HEARTBEAT_MS,
			onProducerStopped: (stopped) => void stopped.then(release),
		});
		const guarded = (async function* () {
			started = true;
			yield* frames;
		})();
		// Never pulled if the client left first, in which case nothing else would release the scope.
		reply.raw.once("close", () => {
			if (!started) release();
		});
		return (
			reply
				.status(route.httpCode ?? 200)
				.header("content-type", "text/event-stream; charset=utf-8")
				.header("cache-control", "no-cache, no-transform")
				.header("x-accel-buffering", "no")
				// A stream owns its connection; closing it afterwards lets app stop finish at once instead of waiting out keep-alive.
				.header("connection", "close")
				.send(Readable.from(guarded))
		);
	}

	private applyResponseHeaders(reply: FastifyReply, httpRequest: HttpRequest) {
		reply.header(REQUEST_ID_HEADER, httpRequest.requestId);
		for (const [name, value] of Object.entries(httpRequest.responseHeaders)) {
			reply.header(name, value);
		}
	}

	private fastifyToRequest(fastifyRequest: FastifyRequest): HttpRequest {
		const method = fastifyRequest.method;
		const url = fastifyRequest.url;
		const params = fastifyRequest.params as Record<string, string>;
		const query = fastifyRequest.query as Record<string, string>;
		const body = fastifyRequest.body ?? {};
		const headers: Record<string, string> = {};
		for (const [key, value] of Object.entries(fastifyRequest.headers)) {
			if (typeof value === "string") {
				headers[key.toLowerCase()] = value;
			}
		}
		const requestId = resolveRequestId(headers, String(fastifyRequest.id ?? ""));
		return new HttpRequest({
			requestId,
			url,
			method,
			params,
			query,
			body,
			headers,
		});
	}
}
