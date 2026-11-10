import {
	type ConfigurationDataSource,
	config,
	EnvDataSource,
	YamlDataSource,
} from "@decohere/config";
import type { BuilderPlugin } from "@decohere/core/hosting";
import type { Constructable } from "@decohere/core/reflection";
import { scribe } from "@decohere/scribe";
import "@decohere/scribe-pino";
import { type HealthOptions, health } from "../health/health.plugin.js";
import { type HttpPluginOptions, http } from "../http/http.plugin.js";
import type { OpenApiOptions } from "../openapi/openapi.types.js";
import { FastifyProvider } from "../providers/fastify.provider.js";
import type { HttpProvider } from "../routing/http.types.js";

/** How {@link webApi} sets up logging. */
export type WebApiLogging = {
	/**
	 * The rolled log file in development. Default `logs/<applicationName>.log`, or `logs/app.log`
	 * when the builder has no name. `false` writes no file. `SCRIBE_LOG_FILE` overrides it.
	 */
	file?: string | false;
	/** Default from `LOG_LEVEL` / `SCRIBE_LOG_LEVEL`, else `info`. */
	level?: string;
};

/** What {@link webApi} takes. Every part is on by default; `false` leaves it out. */
export type WebApiOptions = {
	controllers?: Constructable[];
	/**
	 * The app's name in a project with several: it also reads `config.<app>.yaml` and
	 * `config.<app>.<NODE_ENV>.yaml`, and one of them must exist.
	 */
	app?: string;
	/** Everything `http(...)` takes besides the controllers, such as `globalPrefix` or `cors`. */
	http?: Omit<HttpPluginOptions, "controllers" | "openApi">;
	/** Default Fastify. */
	provider?: Constructable<HttpProvider>;
	/**
	 * Where configuration comes from, later sources winning. Default the YAML files in `config/`,
	 * if there are any, then `SECTION__KEY` environment variables. `false` adds none: add
	 * `config(...)` yourself.
	 */
	config?: (Constructable<ConfigurationDataSource> | ConfigurationDataSource)[] | false;
	/**
	 * Default Pino: pretty lines on the console and a rolled file in development, JSON on stdout
	 * in production. `false` leaves Scribe as it is, for an app that configures it itself.
	 */
	logging?: WebApiLogging | false;
	/** `/health` and `/ready`. */
	health?: HealthOptions | false;
	/**
	 * The OpenAPI document at `/openapi.json`, which also validates requests. Default title is the
	 * builder's application name.
	 */
	openApi?: OpenApiOptions | false;
};

/**
 * A web API with the usual parts: Fastify, configuration from YAML files and the environment,
 * Pino logging, `/health` and `/ready`, and an OpenAPI document. Each part can be changed or
 * turned off, and anything else goes on the builder as usual.
 *
 * @example
 * Builder.create(new ServiceContainerBuilder()).use(webApi({ controllers: [HelloController] }));
 */
export function webApi(options: WebApiOptions = {}): BuilderPlugin {
	return (builder) => {
		const name = builder.applicationName;
		if (options.logging !== false) configureLogging(options.logging ?? {}, name ?? "app");

		const openApi =
			options.openApi === false
				? undefined
				: (options.openApi ?? { info: { title: name ?? "API", version: "1.0.0" } });
		builder.use(
			http(options.provider ?? FastifyProvider, {
				...options.http,
				controllers: options.controllers ?? [],
				...(openApi != null ? { openApi } : {}),
			}),
		);

		if (options.config !== false) {
			builder.use(
				config(
					...(options.config ?? [new YamlDataSource({ app: options.app }), EnvDataSource]),
				),
			);
		}
		if (options.health !== false) builder.use(health(options.health));
	};
}

function configureLogging(logging: WebApiLogging, name: string) {
	const pretty = scribe.withPinoPretty(logging.level);
	const file = logging.file ?? `logs/${name}.log`;
	if (file !== false) pretty.and.withPinoRoll({ file, logLevel: logging.level });
}
