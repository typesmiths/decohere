import { config, EnvDataSource, YamlDataSource } from "@decohere/config";
import { Builder } from "@decohere/core/hosting";
import { ServiceContainerBuilder } from "@decohere/crucible";
import { health, http } from "@decohere/http";
import { FastifyProvider } from "@decohere/http-fastify";
import { scribe } from "@decohere/scribe";
import { pino } from "@decohere/scribe-pino";
import { HelloController } from "./controllers/hello.controller.js";
import { SampleService } from "./services/sample.service.js";

/** Builds the app and starts nothing: main.ts starts it, and tests and tools use it as built. */
export function createApp() {
	// Pretty lines and rolling files on a developer's machine; JSON on stdout in production.
	const development = process.env.NODE_ENV !== "production";
	scribe.use(
		pino(
			development ? { pretty: true, roll: { file: "logs/workspace-name.app-name.log" } } : {},
		),
	);
	return Builder.create(new ServiceContainerBuilder(), {
		applicationName: "workspace-name.app-name",
	})
		.use(
			http(FastifyProvider, {
				controllers: [HelloController],
				openApi: { info: { title: "workspace-name.app-name", version: "1.0.0" } },
			}),
		)
		.use(config(new YamlDataSource({ app: "app-name" }), EnvDataSource))
		.use(health())
		.withServices((services) => {
			services.registerSingleton(SampleService);
		})
		.build();
}
