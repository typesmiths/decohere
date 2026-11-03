import type { ContainerBuilder } from "@decohere/crucible";
import { extension } from "@decohere/core/extensibility";
import { Builder } from "../builder/builder.js";
import { ReadinessCheckToken, ReadinessServiceToken } from "../const.js";
import "../http/http.extensions.js";
import { getOrCreateHttpOptions } from "../http/http.options.store.js";
import { HealthController } from "./health.controller.js";
import { ReadinessService } from "./readiness.service.js";
import type { IReadinessCheck } from "./readiness.types.js";

export type WithHealthOptions = {
	/** Extra readiness probes (e.g. custom dependency checks). */
	checks?: IReadinessCheck[];
	/**
	 * Serve the probes under the global prefix (`/api/health`) instead of at the root. Default
	 * `false`: Cloud Run, Kubernetes and most load balancers probe the root.
	 */
	underGlobalPrefix?: boolean;
};

declare module "@decohere/http" {
	interface Builder {
		/**
		 * Register anonymous `/health` (liveness) and `/ready` (readiness) routes.
		 *
		 * Readiness runs every {@link IReadinessCheck} registered under
		 * {@link ReadinessCheckToken} (TypeORM registers one per datasource when
		 * `.withTypeOrm()` is used). Pass `checks` for app-specific probes.
		 *
		 * The probes stay at the root under `withGlobalPrefix`, unless `underGlobalPrefix` is set.
		 *
		 * Requires `.withHttpProvider(...)` (or `@decohere/http/http` side-effect).
		 */
		withHealth(options?: WithHealthOptions): Builder;
	}
}

export class BuilderExtensions {
	@extension(Builder)
	public static withHealth(builder: Builder, options?: WithHealthOptions) {
		builder.withServices((containerBuilder: ContainerBuilder) => {
			containerBuilder.registerSingleton(ReadinessServiceToken, ReadinessService);
			for (const check of options?.checks ?? []) {
				containerBuilder.registerSingleton(ReadinessCheckToken, check);
			}
		});
		if (options?.underGlobalPrefix === true) {
			getOrCreateHttpOptions(builder).underGlobalPrefix.add(HealthController);
		}
		builder.withControllers(HealthController);
		return builder;
	}
}
