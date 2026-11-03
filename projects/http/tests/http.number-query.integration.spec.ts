import axios from "axios";
import { afterEach, describe, expect, it } from "vitest";
import type { App } from "../src/app/app.js";
import { Builder } from "../src/builder/builder.js";
import "../src/http/http.extensions.js";
import { FastifyProvider } from "../src/providers/fastify.provider.js";
import { Controller, Get, Query } from "../src/routing/index.js";
import { listenEphemeral } from "./helpers/listen-ephemeral.js";

@Controller({ prefix: "/page" })
class PageController {
	@Get()
	public get(@Query("size") size: number) {
		return { size: size ?? null };
	}
}

// A value that isn't a number used to reach the handler as `undefined`, so
// `?size=abc` behaved like `?size` was missing. It must be rejected with 400, like the
// boolean and date pipes do.
describe("NumberPipe over HTTP query", () => {
	let app: App;

	afterEach(async () => {
		await app?.dispose();
	});

	async function start() {
		app = await Builder.create()
			.withHttpProvider(FastifyProvider)
			.withControllers(PageController)
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);
	}

	it.each([
		["10", 10],
		["-3", -3],
		["2.5", 2.5],
		[" 7 ", 7],
	] as const)("binds ?size=%s to %s", async (raw, expected) => {
		await start();
		const res = await axios.get("/page", { params: { size: raw } });
		expect(res.data).toEqual({ size: expected });
	});

	it("leaves a missing value undefined", async () => {
		await start();
		const res = await axios.get("/page");
		expect(res.data).toEqual({ size: null });
	});

	it.each(["abc", "", "   ", "12abc", "Infinity", "NaN"])(
		"rejects ?size=%j with 400",
		async (raw) => {
			await start();
			const res = await axios.get("/page", {
				params: { size: raw },
				validateStatus: () => true,
			});
			expect(res.status).toBe(400);
			expect(res.data).toMatchObject({ statusCode: 400, error: "Bad Request" });
		},
	);
});
