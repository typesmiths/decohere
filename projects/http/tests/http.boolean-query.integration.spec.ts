import { http } from "../src/http/http.plugin.js";
import { ServiceContainerBuilder } from "@decohere/crucible";
import axios from "axios";
import { afterEach, describe, expect, it } from "vitest";
import { type App, Builder } from "@decohere/core/hosting";
import { FastifyProvider } from "../src/providers/fastify.provider.js";
import { Controller, Get, Query } from "../src/routing/index.js";
import { startTestApp } from "../src/testing/index.js";

@Controller({ prefix: "/flags" })
class FlagController {
	@Get()
	public get(@Query("flag") flag: boolean) {
		return { flag };
	}
}

describe("BooleanPipe over HTTP query", () => {
	let app: App;

	afterEach(async () => {
		await app?.dispose();
	});

	async function start() {
		app = await Builder.create(new ServiceContainerBuilder())
			.use(http(FastifyProvider, { accessLog: false, controllers: [FlagController] }))
			.build();
		axios.defaults.baseURL = (await startTestApp(app)).baseUrl;
	}

	it.each([
		["true", true],
		["TRUE", true],
		["1", true],
		["false", false],
		["FALSE", false],
		["0", false],
	] as const)("binds ?flag=%s to %s", async (raw, expected) => {
		await start();
		const res = await axios.get("/flags", { params: { flag: raw } });
		expect(res.status).toBe(200);
		expect(res.data).toEqual({ flag: expected });
	});

	it("rejects an unknown flag value with 400", async () => {
		await start();
		const res = await axios.get("/flags", {
			params: { flag: "yes" },
			validateStatus: () => true,
		});
		expect(res.status).toBe(400);
		expect(res.data).toMatchObject({
			type: "about:blank",
			title: "Bad Request",
			status: 400,
		});
	});
});
