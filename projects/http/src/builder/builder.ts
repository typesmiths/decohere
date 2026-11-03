import {
	type ContainerBuilder,
	ServiceContainerBuilder,
	type IContainer,
} from "@decohere/crucible";
import {
	ConfigurationServiceToken,
	type IConfigurationService,
} from "@decohere/core/configuration";
import type { Constructable } from "@decohere/core/reflection";
import { type Logger, scribe } from "@decohere/scribe";
import { App } from "../app/app.js";
import { HostedServiceHostToken } from "../const.js";
import type { HostedService } from "../hosting/hosted-service.js";
import { HostedServiceHost } from "../hosting/hosted-service-host.js";

export type BuilderOptions = {
	containerBuilder?: ServiceContainerBuilder;
	applicationName?: string;
};

export class Builder<T extends App = App> {
	public static create<T extends App = App>(options?: BuilderOptions) {
		return new Builder<T>(options);
	}

	public readonly containerBuilder: ServiceContainerBuilder;
	public readonly applicationName?: string;
	private readonly logger: Logger = scribe.logger("name");
	private userServices: ((containerBuilder: ContainerBuilder) => void)[] = [];
	private preBuildSteps: ((
		config: IConfigurationService,
		containerBuilder: ContainerBuilder,
	) => Promise<void> | void)[] = [];
	private postBuildSteps: ((container: IContainer) => Promise<void> | void)[] = [];
	private readonly hostedServices = new HostedServiceHost();

	public constructor(options?: BuilderOptions) {
		this.containerBuilder = options?.containerBuilder ?? new ServiceContainerBuilder();
		this.applicationName = options?.applicationName;
	}

	public withServices(userServices: (containerBuilder: ContainerBuilder) => void): Builder<T> {
		this.userServices.push(userServices);
		return this;
	}

	/**
	 * Run {@link HostedService}s for the life of the app: started in this order before the HTTP
	 * server listens, stopped in reverse when the app stops (including SIGTERM and Flux reboots).
	 * Each is registered as a singleton, so other services can inject it by its class.
	 */
	public withHostedService(...types: Constructable<HostedService>[]): Builder<T> {
		for (const type of types) this.containerBuilder.registerSingleton(type);
		this.hostedServices.add(...types);
		return this;
	}

	public registerPreBuildStep(
		step: (
			config: IConfigurationService,
			containerBuilder: ContainerBuilder,
		) => Promise<void> | void,
	) {
		this.preBuildSteps.push(step);
	}

	public registerPostBuildStep(step: (container: IContainer) => Promise<void> | void) {
		this.postBuildSteps.push(step);
	}

	public async buildAndStart<T extends App>(type?: Constructable<T>): Promise<T | App> {
		const app = await this.build(type);
		await app.start();
		this.logger.info("App started...");
		return app;
	}

	public async build<T extends App = App>(type?: Constructable<T>): Promise<T | App> {
		this.logger.info("Building App...");
		this.configureUserServices();
		this.configureApp(type);
		await this.runPreBuildSteps(this.containerBuilder);
		const container = this.containerBuilder.build();
		await this.runPostBuildSteps(container);
		const app = this.resolveApp(container, type);
		return app;
	}

	private configureUserServices() {
		for (const userService of this.userServices) {
			userService(this.containerBuilder);
		}
	}

	private async runPreBuildSteps(containerBuilder: ContainerBuilder) {
		if (this.preBuildSteps.length === 0) {
			return;
		}
		const container = containerBuilder.build();
		const config = container.resolve(ConfigurationServiceToken) as IConfigurationService;
		for (const step of this.preBuildSteps) {
			await step(config, containerBuilder);
		}
	}

	private async runPostBuildSteps(container: IContainer) {
		for (const step of this.postBuildSteps) {
			await step(container);
		}
	}

	private configureApp(type: Constructable) {
		this.containerBuilder.registerSingleton(HostedServiceHostToken, this.hostedServices);
		this.containerBuilder.registerSingleton(type ?? App);
	}

	private resolveApp<T extends App>(container: IContainer, type: Constructable<T>) {
		const app = type ? container.resolve(type) : container.resolve(App);
		return app;
	}
}
