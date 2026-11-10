import { http } from "../src/http/http.plugin.js";
import { ServiceContainerBuilder } from "@decohere/crucible";
import { Ajv } from "ajv";
import axios from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type App, Builder } from "@decohere/core/hosting";
import { FastifyProvider } from "@decohere/http-fastify";
import { Controller, Field, Param, Post, RequestParts } from "../src/routing/index.js";
import { listenEphemeral } from "./helpers/listen-ephemeral.js";

class NoteBody {
	@Field(RequestParts.body, "text")
	public text!: string;
}

@Controller({ prefix: "/notes" })
class NoteController {
	@Post("/:id")
	public save(@Param("id") id: string, body: NoteBody) {
		return { id, text: body.text };
	}
}

// Validators were compiled on every request, and AJV keeps every compiled schema,
// so memory grew with traffic. Each route's validators must be compiled once and reused.
describe("request validation compiles each route's schemas once", () => {
	let app: App;

	afterEach(async () => {
		await app?.dispose();
		vi.restoreAllMocks();
	});

	it("does not compile again for later requests to the same route", async () => {
		app = await Builder.create(new ServiceContainerBuilder())
			.use(
				http(FastifyProvider, {
					accessLog: false,
					controllers: [NoteController],
					openApi: { info: { title: "Notes", version: "1.0.0" }, path: "/openapi.json" },
				}),
			)
			.build();
		const baseURL = await listenEphemeral(app);
		const compile = vi.spyOn(Ajv.prototype, "compile");
		const post = (body: object) =>
			axios.post("/notes/1", body, { baseURL, validateStatus: () => true });

		expect((await post({ text: "first" })).status).toBe(200);
		const afterFirst = compile.mock.calls.length;

		for (let i = 0; i < 20; i++) {
			expect((await post({ text: `note ${i}` })).status).toBe(200);
		}
		expect((await post({})).status).toBe(400);

		expect(compile.mock.calls.length).toBe(afterFirst);
	});
});
