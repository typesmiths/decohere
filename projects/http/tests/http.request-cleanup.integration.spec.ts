import { http } from "../src/http/http.plugin.js";
import { ServiceContainerBuilder } from "@decohere/crucible";
import { inject, injectable } from "@decohere/crucible/decorators";
import axios from "axios";
import { afterEach, describe, expect, it } from "vitest";
import { type App, Builder } from "@decohere/core/hosting";
import { FastifyProvider } from "@decohere/http-fastify";
import { Controller, Get } from "../src/routing/index.js";
import { listenEphemeral } from "./helpers/listen-ephemeral.js";

const cleanedUp: string[] = [];
const WorkToken = Symbol("RequestWork");

/** Stands in for a unit of work: its async cleanup must finish before the response goes out. */
@injectable()
class RequestWork {
	public async [Symbol.asyncDispose]() {
		await new Promise((resolve) => setTimeout(resolve, 20));
		cleanedUp.push("done");
	}
}

@Controller({ prefix: "/work" })
class WorkController {
	public constructor(@inject(WorkToken) private readonly work: RequestWork) {}

	@Get("/fail")
	public fail() {
		void this.work;
		throw new Error("boom");
	}
}

// Per-request objects were disposed synchronously, so async cleanup (rolling back a
// transaction, releasing a DB connection) was started but never awaited.
describe("per-request cleanup", () => {
	let app: App;

	afterEach(async () => {
		await app?.dispose();
		cleanedUp.length = 0;
	});

	it("awaits async cleanup of request-scoped services, even when the handler throws", async () => {
		app = await Builder.create(new ServiceContainerBuilder())
			.use(http(FastifyProvider, { controllers: [WorkController] }))
			.withServices((c) => c.registerRequestScoped(WorkToken, RequestWork))
			.build();
		const baseURL = await listenEphemeral(app);

		const res = await axios.get("/work/fail", { baseURL, validateStatus: () => true });

		expect(res.status).toBe(500);
		expect(cleanedUp).toEqual(["done"]);
	});
});
