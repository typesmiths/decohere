import { http } from "../src/http/http.plugin.js";
import { ServiceContainerBuilder } from "@decohere/crucible";
import { scribe } from "@decohere/scribe";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type App, Builder } from "@decohere/core/hosting";
import { FastifyProvider } from "../src/providers/fastify.provider.js";
import { Controller, Get, Param, Query } from "../src/routing/index.js";
import { listenEphemeral } from "./helpers/listen-ephemeral.js";

@Controller({ prefix: "/echo" })
class EchoController {
	@Get()
	public root() {
		return { ok: true };
	}

	@Get("/query")
	public getWithArgs(@Query("arg1") arg1: string) {
		return { arg1 };
	}

	@Get("/:param1/:param2")
	public getWithParams(@Param("param1") param1: string, @Param("param2") param2: string) {
		return { param1, param2 };
	}

	@Get("/count")
	public count(@Query("n") n: number) {
		return { n };
	}
}

describe("App HTTP routing", () => {
	let app: App;

	beforeEach(async () => {
		app = await Builder.create(new ServiceContainerBuilder())
			.use(http(FastifyProvider, { accessLog: false, controllers: [EchoController] }))
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);
	});

	afterEach(async () => {
		await app.dispose();
	});

	it("returns the handler body for GET with no arguments", async () => {
		const res = await axios.get("/echo");
		expect(res.status).toBe(200);
		expect(res.data).toEqual({ ok: true });
	});

	it("binds a query string argument into the response", async () => {
		const res = await axios.get("/echo/query", { params: { arg1: "arg1Value" } });
		expect(res.status).toBe(200);
		expect(res.data).toEqual({ arg1: "arg1Value" });
	});

	it("binds path params into the response", async () => {
		const res = await axios.get("/echo/arg1Value/arg2Value");
		expect(res.status).toBe(200);
		expect(res.data).toEqual({ param1: "arg1Value", param2: "arg2Value" });
	});

	it("coerces a numeric query argument", async () => {
		const res = await axios.get("/echo/count", { params: { n: "5" } });
		expect(res.status).toBe(200);
		expect(res.data).toEqual({ n: 5 });
	});

	it("advertises the OS-assigned port after listen(0)", () => {
		const origin = axios.defaults.baseURL;
		expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		expect(Number(new URL(origin ?? "").port)).toBeGreaterThan(0);
		expect(app.addresses).toContain(origin);
	});

	it("starts two apps without a port collision", async () => {
		const originA = axios.defaults.baseURL;
		const other = await Builder.create(new ServiceContainerBuilder())
			.use(http(FastifyProvider, { accessLog: false, controllers: [EchoController] }))
			.build();
		try {
			const originB = await listenEphemeral(other);
			expect(originA).not.toBe(originB);
			expect(originB).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		} finally {
			await other.dispose();
		}
	});

	it("dispose drains scribe after the container", async () => {
		const stop = vi.spyOn(scribe, "stop").mockResolvedValue();
		await app.dispose();
		expect(stop).toHaveBeenCalledOnce();
		stop.mockRestore();
	});
});

describe("App container dispose", () => {
	class SocketHub {
		public closed = false;
		public async [Symbol.asyncDispose]() {
			this.closed = true;
		}
	}

	it("closes HTTP and constructed DI services on dispose", async () => {
		let hub: SocketHub | undefined;
		const builder = Builder.create(new ServiceContainerBuilder())
			.use(http(FastifyProvider, { accessLog: false, controllers: [EchoController] }))
			.withServices((cb) => {
				cb.registerSingleton(SocketHub);
			});
		builder.registerPostBuildStep((container) => {
			hub = container.resolve(SocketHub);
		});
		const disposable = await builder.build();
		const origin = await listenEphemeral(disposable);
		await axios.get(`${origin}/echo`);

		await disposable.dispose();
		await disposable.dispose();

		expect(hub?.closed).toBe(true);
		await expect(axios.get(`${origin}/echo`, { timeout: 1_000 })).rejects.toThrow();
	});
});
