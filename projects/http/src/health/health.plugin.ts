import {
	type BuilderPlugin,
	type IReadinessCheck,
	ReadinessCheckToken,
} from "@decohere/core/hosting";
import type { ContainerBuilder } from "@decohere/crucible";
import { ReadinessServiceToken } from "../const.js";
import { getOrCreateHttpOptions } from "../http/http.options.store.js";
import { configureHttp } from "../http/http.plugin.js";
import { HealthController } from "./health.controller.js";
import { ReadinessService } from "./readiness.service.js";

export type HealthOptions = {
	/** Extra readiness probes (e.g. custom dependency checks). */
	checks?: IReadinessCheck[];
	/**
	 * Serve the probes under the global prefix (`/api/health`) instead of at the root. Default
	 * `false`: Cloud Run, Kubernetes and most load balancers probe the root.
	 */
	underGlobalPrefix?: boolean;
};

/**
 * Add anonymous `/health` (liveness) and `/ready` (readiness) routes to an app using `http(...)`.
 *
 * Readiness runs every {@link IReadinessCheck} registered under {@link ReadinessCheckToken}
 * (`typeOrm()` registers one per datasource). Pass `checks` for app-specific probes.
 *
 * The probes stay at the root under a global prefix, unless `underGlobalPrefix` is set.
 */
export function health(options?: HealthOptions): BuilderPlugin {
	return (builder) => {
		builder.withServices((containerBuilder: ContainerBuilder) => {
			containerBuilder.registerSingleton(ReadinessServiceToken, ReadinessService);
			for (const check of options?.checks ?? []) {
				containerBuilder.registerSingleton(ReadinessCheckToken, check);
			}
		});
		if (options?.underGlobalPrefix === true) {
			getOrCreateHttpOptions(builder).underGlobalPrefix.add(HealthController);
		}
		configureHttp({ controllers: [HealthController] })(builder);
	};
}
