import { Builder, type HostedService } from "@decohere/core/hosting";
import { ServiceContainerBuilder } from "@decohere/crucible";
import { Controller, Get, http } from "@decohere/http";
import { FastifyProvider } from "@decohere/http/providers";
import { bootModule, startTestApp } from "@decohere/http/testing";
import { describe, expect, it } from "vitest";

@Controller({ prefix: "/ping" })
class PingController {
	@Get()
	public ping() {
		return { pong: true };
	}
}

class BrokenFeed implements HostedService {
	public start() {
		throw new Error("feed is down");
	}
}

function buildApp() {
	return Builder.create(new ServiceContainerBuilder())
		.use(http(FastifyProvider, { accessLog: false, controllers: [PingController] }))
		.build();
}

describe("@decohere/http/testing", () => {
	it("starts an app on a free loopback port and gives its origin", async () => {
		await using api = await startTestApp(buildApp());

		expect(api.baseUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
		const response = await fetch(`${api.baseUrl}/ping`);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ pong: true });
	});

	it("stops the app at the end of the block", async () => {
		let origin: string;
		{
			await using api = await startTestApp(buildApp());
			origin = api.baseUrl;
		}

		await expect(fetch(`${origin}/ping`)).rejects.toThrow();
	});

	it("gives two apps two ports", async () => {
		await using first = await startTestApp(buildApp());
		await using second = await startTestApp(buildApp());

		expect(first.baseUrl).not.toBe(second.baseUrl);
	});

	it("boots controllers and the services they need without an app of their own", async () => {
		await using api = await bootModule({ controllers: [PingController] });

		expect((await fetch(`${api.baseUrl}/ping`)).status).toBe(200);
	});

	it("rejects with the reason an app fails to start", async () => {
		const app = Builder.create(new ServiceContainerBuilder())
			.use(http(FastifyProvider, { accessLog: false, controllers: [PingController] }))
			.withHostedService(BrokenFeed)
			.build();

		await expect(startTestApp(app)).rejects.toThrow("feed is down");
	});
});
