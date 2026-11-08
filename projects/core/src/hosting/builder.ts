import { type Logger, scribe } from "@decohere/scribe";
import type { ContainerBuilder, IContainer } from "../composition/index.js";
import {
	ConfigurationServiceToken,
	type IConfigurationService,
} from "../configuration/index.js";
import type { Constructable } from "../reflection/index.js";
import { App } from "./app.js";
import { HostedServiceHostToken, type StartStep, StartStepsToken } from "./const.js";
import type { HostedService } from "./hosted-service.js";
import { HostedServiceHost } from "./hosted-service-host.js";

export type BuilderOptions = {
	applicationName?: string;
};

/**
 * A feature an app adds with `builder.use(...)`, such as `http(...)` or `config(...)`. A plugin is
 * a plain function: it registers what it needs on the builder it gets.
 */
export type BuilderPlugin = (builder: Builder) => void;

export class Builder<T extends App = App> {
	/**
	 * @param containerBuilder The container the app runs on: `new ServiceContainerBuilder()` from
	 * `@decohere/crucible`. It is an argument because `core` sits below the container that implements it.
	 */
	public static create<T extends App = App>(
		containerBuilder: ContainerBuilder,
		options?: BuilderOptions,
	) {
		return new Builder<T>(containerBuilder, options);
	}

	public readonly containerBuilder: ContainerBuilder;
	public readonly applicationName?: string;
	private readonly logger: Logger = scribe.logger(Builder.name);
	private userServices: ((containerBuilder: ContainerBuilder) => void)[] = [];
	private preBuildSteps: ((
		config: IConfigurationService,
		containerBuilder: ContainerBuilder,
	) => Promise<void> | void)[] = [];
	private postBuildSteps: ((container: IContainer) => Promise<void> | void)[] = [];
	private readonly startSteps: StartStep[] = [];
	private readonly hostedServices = new HostedServiceHost();

	public constructor(containerBuilder: ContainerBuilder, options?: BuilderOptions) {
		this.containerBuilder = containerBuilder;
		this.applicationName = options?.applicationName;
	}

	public use(plugin: BuilderPlugin): this {
		plugin(this);
		return this;
	}

	public withServices(userServices: (containerBuilder: ContainerBuilder) => void): Builder<T> {
		this.userServices.push(userServices);
		return this;
	}

	/**
	 * Run {@link HostedService}s for the life of the app: started in this order before the
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

	/**
	 * Run `step` when the app starts, in registration order, before its hosted services start and
	 * its server listens. For work that changes the world outside the process, such as bringing a
	 * database's schema up to date: an app that is only built, by a tool or a test, does none of it.
	 * A throw fails `app.start()`.
	 */
	public registerStartStep(step: StartStep) {
		this.startSteps.push(step);
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
		this.containerBuilder.registerSingleton(StartStepsToken, { steps: this.startSteps });
		this.containerBuilder.registerSingleton(type ?? App);
	}

	private resolveApp<T extends App>(container: IContainer, type: Constructable<T>) {
		const app = type ? container.resolve(type) : container.resolve(App);
		return app;
	}
}
