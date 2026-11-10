import { inject } from "@decohere/crucible/decorators";
import { Controller, Delete, Field, Get, Param, Post, Put, Query } from "@decohere/http";
import { SampleService } from "../services/sample.service.js";

class HelloBody {
	@Field("body", "message")
	public message!: string;
}

@Controller({ prefix: "/hello" })
export class HelloController {
	// @inject names the class: an import used only as a type can be dropped, and the parameter
	// would then be injected as Object.
	public constructor(@inject(SampleService) private readonly sample: SampleService) {}

	@Get()
	public async getAll(@Query("filter") filter: string) {
		const greeting = await this.sample.getGreeting();
		return { filter, message: greeting };
	}

	@Get("/:id")
	public getOne(@Param("id") id: string) {
		return { id, message: `Hello ${id}!` };
	}

	@Post()
	public create(body: HelloBody) {
		return { message: body.message };
	}

	@Put("/:id")
	public update(@Param("id") id: string, body: HelloBody) {
		return { id, message: body.message };
	}

	@Delete("/:id")
	public remove(@Param("id") id: string) {
		return { id, deleted: true };
	}
}
