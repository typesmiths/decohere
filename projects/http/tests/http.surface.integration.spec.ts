import { http } from "../src/http/http.plugin.js";
import { ServiceContainerBuilder } from "@decohere/crucible";
import { injectable } from "@decohere/crucible/decorators";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type App, Builder } from "@decohere/core/hosting";
import { FastifyProvider } from "../src/providers/fastify.provider.js";
import {
	Catch,
	Controller,
	type ExceptionContext,
	type ExceptionFilter,
	type ExceptionResult,
	Get,
	Header,
	HttpCode,
	HttpError,
	type Middleware,
	type MiddlewareContext,
	Post,
} from "../src/routing/index.js";
import { listenEphemeral } from "./helpers/listen-ephemeral.js";

class NotFoundError extends HttpError {
	public constructor(message = "Not Found") {
		super(message, 404);
	}
}

@Catch(NotFoundError)
@injectable()
class NotFoundFilter implements ExceptionFilter {
	public catch(error: NotFoundError, _ctx: ExceptionContext): ExceptionResult {
		return { status: error.status, body: { code: "NOT_FOUND", message: error.message } };
	}
}

@injectable()
class TraceMiddleware implements Middleware {
	public static calls = 0;
	public async use(ctx: MiddlewareContext, next: () => Promise<unknown>) {
		TraceMiddleware.calls += 1;
		ctx.request.headers["x-mw"] = "1";
		return next();
	}
}

@Controller({ prefix: "/scope" })
class ScopedController {
	private static nextId = 0;
	private readonly id = ++ScopedController.nextId;

	@Get()
	public who() {
		return { id: this.id };
	}
}

@Controller({ prefix: "/widgets" })
class WidgetController {
	@HttpCode(201)
	@Header("X-Widget", "yes")
	@Post()
	public create() {
		return { id: 1 };
	}

	@Get("/missing")
	public missing() {
		throw new NotFoundError("widget gone");
	}

	@Get("/boom")
	public boom() {
		throw new Error("kaboom");
	}

	@Get()
	public list() {
		return { ok: true };
	}
}

describe("HTTP surface (filters, HttpCode/Header, middleware, CORS, global prefix)", () => {
	let app: App;

	beforeEach(() => {
		TraceMiddleware.calls = 0;
	});

	afterEach(async () => {
		await app?.dispose();
	});

	it("applies global prefix, HttpCode, Header, middleware, CORS, and exception filters", async () => {
		app = await Builder.create(new ServiceContainerBuilder())
			.use(
				http(FastifyProvider, {
					accessLog: false,
					controllers: [WidgetController],
					middleware: [TraceMiddleware],
					exceptionFilters: [NotFoundFilter],
					globalPrefix: "/api",
					cors: { origin: "https://example.com", credentials: true },
				}),
			)
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);

		const created = await axios.post(
			"/api/widgets",
			{},
			{
				headers: { "Content-Type": "application/json" },
			},
		);
		expect(created.status).toBe(201);
		expect(created.headers["x-widget"]).toBe("yes");
		expect(created.data).toEqual({ id: 1 });
		expect(TraceMiddleware.calls).toBeGreaterThanOrEqual(1);

		const missing = await axios.get("/api/widgets/missing", { validateStatus: () => true });
		expect(missing.status).toBe(404);
		expect(missing.data).toEqual({ code: "NOT_FOUND", message: "widget gone" });

		const boom = await axios.get("/api/widgets/boom", { validateStatus: () => true });
		expect(boom.status).toBe(500);
		expect(boom.data).toEqual({ message: "Internal Server Error" });
		expect(JSON.stringify(boom.data)).not.toMatch(/kaboom/i);

		const preflight = await axios.options("/api/widgets", {
			headers: {
				Origin: "https://example.com",
				"Access-Control-Request-Method": "POST",
			},
			validateStatus: () => true,
		});
		expect(preflight.status).toBe(204);
		expect(preflight.headers["access-control-allow-origin"]).toBe("https://example.com");
		expect(preflight.headers["access-control-allow-credentials"]).toBe("true");

		const listed = await axios.get("/api/widgets", {
			headers: { Origin: "https://example.com" },
		});
		expect(listed.status).toBe(200);
		expect(listed.headers["access-control-allow-origin"]).toBe("https://example.com");
	});

	it("returns 404 for an unregistered path", async () => {
		app = await Builder.create(new ServiceContainerBuilder())
			.use(http(FastifyProvider, { accessLog: false, controllers: [WidgetController] }))
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);

		const missing = await axios.get("/nope", { validateStatus: () => true });
		expect(missing.status).toBe(404);
	});

	it("creates a new controller instance per request", async () => {
		app = await Builder.create(new ServiceContainerBuilder())
			.use(http(FastifyProvider, { accessLog: false, controllers: [ScopedController] }))
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);

		const first = await axios.get("/scope");
		const second = await axios.get("/scope");
		expect(first.data.id).not.toBe(second.data.id);
	});
});
