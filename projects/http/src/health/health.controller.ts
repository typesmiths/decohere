import { inject, injectable } from "@decohere/crucible/decorators";
import { ReadinessServiceToken } from "../const.js";
import { HttpError } from "../routing/http.types.js";
import { AllowAnonymous, Controller, Get } from "../routing/index.js";
import { ReadinessService } from "./readiness.service.js";

/**
 * Liveness (`/health`) and readiness (`/ready`) probes.
 * Both are anonymous so orchestration can scrape them with auth enabled, and stay at the root
 * under a global prefix, where platforms look for them.
 */
@Controller({ prefix: "/", globalPrefix: false })
@injectable()
export class HealthController {
	public constructor(
		@inject(ReadinessServiceToken) private readonly readiness: ReadinessService,
	) {}

	@AllowAnonymous()
	@Get("/health")
	public health() {
		return { status: "ok" };
	}

	@AllowAnonymous()
	@Get("/ready")
	public async ready() {
		const result = await this.readiness.checkAll();
		if (!result.ok) {
			throw new HttpError("Not ready", 503);
		}
		return { status: "ok" };
	}
}
