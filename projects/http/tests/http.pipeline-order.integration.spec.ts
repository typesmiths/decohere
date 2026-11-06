import { http } from "../src/http/http.plugin.js";
import { auth } from "../src/auth/auth.plugin.js";
import { ServiceContainerBuilder } from "@decohere/crucible";
import type { IConfigurationService } from "@decohere/core/configuration";
import { ConfigurationServiceToken } from "@decohere/core/configuration";
import type { Constructable } from "@decohere/core/reflection";
import { scribe } from "@decohere/scribe";
import axios from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthConfig } from "../src/auth/auth.config.js";
import { type App, Builder } from "@decohere/core/hosting";
import { FastifyProvider } from "../src/providers/fastify.provider.js";
import {
	Authorize,
	Controller,
	Field,
	HttpAccessLogMiddleware,
	Post,
	RequestParts,
} from "../src/routing/index.js";
import { listenEphemeral } from "./helpers/listen-ephemeral.js";

class SecretConfigService implements IConfigurationService {
	public get dataSources() {
		return [];
	}
	public async get<T extends object>(type: Constructable<T> | string): Promise<T> {
		if (type === AuthConfig) {
			const config = new AuthConfig();
			config.secret = "test-secret-at-least-32-bytes-long!!";
			config.audience = "test-audience";
			return config as unknown as T;
		}
		return {} as T;
	}
}

class OrderBody {
	@Field(RequestParts.body, "item")
	public item!: string;
}

@Controller({ prefix: "/orders" })
class OrderController {
	@Authorize("create", "Order")
	@Post()
	public create(body: OrderBody) {
		return { item: body.item };
	}
}

// Auth must run before validation (anonymous callers learn nothing about the body
// schema), and both must run inside the middleware chain so rejections are access-logged.
describe("request pipeline order", () => {
	let app: App;
	const accessLog = { info: vi.fn() };

	beforeEach(async () => {
		const original = scribe.logger.bind(scribe);
		vi.spyOn(scribe, "logger").mockImplementation((name: string) =>
			name === HttpAccessLogMiddleware.name ? (accessLog as never) : original(name),
		);
		app = await Builder.create(new ServiceContainerBuilder())
			.use(
				http(FastifyProvider, {
					controllers: [OrderController],
					openApi: { info: { title: "Orders", version: "1.0.0" }, path: "/openapi.json" },
				}),
			)
			.withServices((c) => {
				c.registerSingleton(ConfigurationServiceToken, new SecretConfigService());
			})
			.use(auth())
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);
	});

	afterEach(async () => {
		await app.dispose();
		vi.restoreAllMocks();
		accessLog.info.mockReset();
	});

	it("rejects an anonymous request with 401 before looking at the body", async () => {
		const res = await axios.post("/orders", { wrong: 1 }, { validateStatus: () => true });

		expect(res.status).toBe(401);
		expect(JSON.stringify(res.data)).not.toMatch(/item|additional property/);
	});

	it("access-logs requests rejected by auth", async () => {
		await axios.post("/orders", {}, { validateStatus: () => true });

		expect(accessLog.info).toHaveBeenCalledWith(
			expect.objectContaining({ msg: "access", path: "/orders", status: 401 }),
		);
	});
});
