import { http } from "../src/http/http.plugin.js";
import { ServiceContainerBuilder } from "@decohere/crucible";
import axios from "axios";
import { afterEach, describe, expect, it } from "vitest";
import { type App, Builder } from "@decohere/core/hosting";
import { FastifyProvider } from "@decohere/http-fastify";
import { Controller, Get, Param, Query } from "../src/routing/index.js";
import { listenEphemeral } from "./helpers/listen-ephemeral.js";

type GroupBy = "colour" | "size";

@Controller({ prefix: "/totals" })
class TotalsController {
	@Get("/many")
	public many(
		@Query("a") a: string,
		@Query("b") b: string,
		@Query("c") c: string,
		@Query("d") d: string,
		@Query("e") e: string,
		@Query("f") f: string,
		@Query("g") g: string,
		@Query("h") h: string,
		@Query("i") i: string,
		@Query("j") j: string,
		@Query("k") k: string,
	) {
		return [a, b, c, d, e, f, g, h, i, j, k];
	}

	@Get("/union")
	public union(@Query("groupBy") groupBy: GroupBy, @Query("name") name: string) {
		return { groupBy: groupBy ?? null, name };
	}

	@Get("/path/:groupBy")
	public path(@Param("groupBy") groupBy: GroupBy) {
		return { groupBy };
	}

	@Get("/optional")
	public optional(@Query("groupBy") groupBy?: string | null) {
		return { groupBy: groupBy ?? null };
	}
}

describe("@Query binding over HTTP", () => {
	let app: App;

	afterEach(async () => {
		await app?.dispose();
	});

	async function start() {
		app = await Builder.create(new ServiceContainerBuilder())
			.use(http(FastifyProvider, { accessLog: false, controllers: [TotalsController] }))
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);
	}

	it("binds each of many parameters by name", async () => {
		await start();
		const params = Object.fromEntries("abcdefghijk".split("").map((key) => [key, `v-${key}`]));

		const res = await axios.get("/totals/many", { params });

		expect(res.data).toEqual(Object.values(params));
	});

	it("binds a parameter typed as a union of strings to its value", async () => {
		await start();

		const res = await axios.get("/totals/union", {
			params: { groupBy: "colour", name: "ada" },
		});

		expect(res.data).toEqual({ groupBy: "colour", name: "ada" });
	});

	it("binds a parameter typed as a nullable string to its value", async () => {
		await start();

		const res = await axios.get("/totals/optional", { params: { groupBy: "colour" } });

		expect(res.data).toEqual({ groupBy: "colour" });
	});

	it("binds a path parameter typed as a union to its value", async () => {
		await start();

		const res = await axios.get("/totals/path/colour");

		expect(res.data).toEqual({ groupBy: "colour" });
	});

	it("documents a union parameter in the OpenAPI document", async () => {
		app = await Builder.create(new ServiceContainerBuilder())
			.use(
				http(FastifyProvider, {
					accessLog: false,
					controllers: [TotalsController],
					openApi: { info: { title: "Totals", version: "1.0.0" }, path: "/openapi.json" },
				}),
			)
			.build();
		axios.defaults.baseURL = await listenEphemeral(app);

		const spec = await axios.get("/openapi.json");

		const names = spec.data.paths["/totals/union"].get.parameters.map(
			(parameter: { name: string }) => parameter.name,
		);
		expect(names).toContain("groupBy");
	});

	it("leaves a missing union parameter undefined rather than an empty object", async () => {
		await start();

		const res = await axios.get("/totals/union", { params: { name: "ada" } });

		expect(res.data).toEqual({ groupBy: null, name: "ada" });
	});
});
