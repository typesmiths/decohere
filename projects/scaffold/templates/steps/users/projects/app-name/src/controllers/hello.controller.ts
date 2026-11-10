import { inject } from "@decohere/crucible/decorators";
import {
	AllowAnonymous,
	Authorize,
	Controller,
	Delete,
	Field,
	Get,
	type IPrincipalProvider,
	IPrincipalProviderToken,
	Param,
	Post,
	Put,
	Query,
} from "@decohere/http";
import { SampleService } from "../services/sample.service.js";
import { UserService } from "../services/user.service.js";

class HelloBody {
	@Field("body", "message")
	public message!: string;
}

// Every route needs a token with the permission named here (read:Hello), or its own below.
@Authorize("read", "Hello")
@Controller({ prefix: "/hello" })
export class HelloController {
	// @inject names the class: an import used only as a type can be dropped, and the parameter
	// would then be injected as Object.
	public constructor(
		@inject(SampleService) private readonly sample: SampleService,
		@inject(IPrincipalProviderToken) private readonly principalProvider: IPrincipalProvider,
		@inject(UserService) private readonly users: UserService,
	) {}

	@AllowAnonymous()
	@Get()
	public async getAll(@Query("filter") filter: string) {
		const greeting = await this.sample.getGreeting();
		return { filter, message: greeting };
	}

	@Get("/:id")
	public async getOne(@Param("id") id: string) {
		// The caller's local profile, made on their first request.
		const user = await this.users.ensureFromPrincipal(this.principalProvider.currentPrincipal);
		return { id, message: `Hello ${user.displayName}!`, username: user.displayName };
	}

	@Authorize("create", "Hello")
	@Post()
	public create(body: HelloBody) {
		return { message: body.message };
	}

	@Authorize("update", "Hello")
	@Put("/:id")
	public update(@Param("id") id: string, body: HelloBody) {
		return { id, message: body.message };
	}

	@Authorize("delete", "Hello")
	@Delete("/:id")
	public remove(@Param("id") id: string) {
		return { id, deleted: true };
	}
}
