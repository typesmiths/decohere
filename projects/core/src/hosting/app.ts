import { scribe } from "@decohere/scribe";
import {
	type IContainer,
	inject,
	type LifetimeScope,
	LifetimeScopeToken,
	optional,
} from "../composition/index.js";
import {
	ConfigurationServiceToken,
	type IConfigurationService,
} from "../configuration/index.js";
import {
	AppServerToken,
	HostedServiceHostToken,
	type StartSteps,
	StartStepsToken,
} from "./const.js";
import type { HostedServiceHost, HostedServiceStartTiming } from "./hosted-service-host.js";

const DEFAULT_PORT = 3000;
const DEFAULT_SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ["SIGTERM", "SIGINT"];
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

export class ApiConfiguration {
	public static schema = {
		type: "object",
		additionalProperties: false,
		properties: { port: { type: "integer", minimum: 0, maximum: 65535 } },
	};

	public port: number;
}

export type AppServerStartOptions = { port: number; host?: string };

export type AppServerStartResponse = { addresses: string[] };

/** What serves traffic, if anything does. The HTTP provider is one; a worker has none. */
export interface AppServer {
	start(options: AppServerStartOptions): Promise<AppServerStartResponse>;
	stop(): Promise<unknown>;
}

export type StartOptions = {
	port: number;
	host?: string;
	/**
	 * Signals that stop the app gracefully: stop accepting connections, let in-flight
	 * requests finish, stop hosted services, then dispose services. Default SIGTERM and SIGINT; `false` to
	 * handle signals yourself.
	 */
	shutdownSignals?: readonly NodeJS.Signals[] | false;
	/** How long a signalled shutdown may take before the process exits with code 1. Default 10s. */
	shutdownTimeoutMs?: number;
	/**
	 * When hosted services start. `"before-listen"` (default): `start()` resolves once every one
	 * has started, and a failure rejects it. `"after-listen"`: the server listens first and they
	 * start in the background, in the same order, while `GET /ready` answers 503; a failure stops
	 * the app and rejects {@link App.hostedServicesStarted}. For a host with a start budget, such
	 * as Cloud Run.
	 */
	hostedServices?: "before-listen" | "after-listen";
};

export class App {
	private _addresses = Array.of<string>();
	private logger = scribe.logger(App.name);
	private disposing: Promise<void> | undefined;
	private disposingContainer = false;
	private signalHandler: ((signal: NodeJS.Signals) => void) | undefined;
	private shutdownSignals: readonly NodeJS.Signals[] = [];
	private hostedStarting: Promise<readonly HostedServiceStartTiming[]> | undefined;

	public constructor(
		@inject(LifetimeScopeToken) private readonly container: LifetimeScope,
		@inject(ConfigurationServiceToken)
		@optional()
		private configurationService?: IConfigurationService,
		@inject(AppServerToken) @optional() private server?: AppServer,
		@inject(HostedServiceHostToken) @optional() private hostedServices?: HostedServiceHost,
		@inject(StartStepsToken) @optional() private startSteps?: StartSteps,
	) {}

	/**
	 * The app's root container, for a tool or a test that builds the app to use its services
	 * without starting it: `decohere`'s db commands resolve its data sources' migrations here.
	 */
	public get services(): IContainer {
		return this.container;
	}

	public get addresses(): readonly string[] {
		return this._addresses;
	}

	public async start(options?: StartOptions): Promise<AppServerStartResponse | undefined> {
		this.logger.info("Starting app");
		for (const step of this.startSteps?.steps ?? []) {
			await step(this.container);
			if (this.disposing != null) return undefined;
		}
		if (options?.hostedServices === "after-listen") {
			const startResponse = await this.listen(options);
			if (this.disposing == null) this.hostedStarting = this.startHostedServicesAfterListen();
			return startResponse;
		}
		// Before the server, so a request never reaches a service that has not started.
		this.hostedStarting = this.startHostedServices();
		await this.hostedStarting;
		// The app was stopped while a hosted service was still starting.
		if (this.disposing != null) return undefined;
		return this.listen(options);
	}

	/**
	 * Resolves once every hosted service has started, with how long each one took, in start order.
	 * With `hostedServices: "after-listen"`, await it in `main.ts` after `start()`: a failure
	 * rejects it, after the app has stopped. Left unawaited, that rejection is unhandled and ends
	 * the process, as a failing `await app.start()` would.
	 */
	public hostedServicesStarted(): Promise<readonly HostedServiceStartTiming[]> {
		return (
			this.hostedStarting ??
			Promise.reject(new Error("hostedServicesStarted() before start()"))
		);
	}

	private async listen(options?: StartOptions): Promise<AppServerStartResponse | undefined> {
		const hasHostedServices = this.hostedServices != null && !this.hostedServices.isEmpty;
		if (!this.server) {
			if (hasHostedServices) this.stopOnSignals(options);
			return undefined;
		}
		const port = await this.getPort(options);
		this.logger.info(`Starting server on port ${port}`);
		const startResponse = await this.server.start({
			port,
			...(options?.host != null ? { host: options.host } : {}),
		});
		this._addresses = [...startResponse.addresses];
		this.logger.info("Listening on:", this._addresses);
		this.stopOnSignals(options);
		return startResponse;
	}

	private async startHostedServices(): Promise<readonly HostedServiceStartTiming[]> {
		const host = this.hostedServices;
		if (host == null || host.isEmpty) return [];
		const begun = performance.now();
		await host.start(this.container);
		const timings = host.timings;
		this.logger.info(
			`Started ${timings.length} hosted services in ${Math.round(performance.now() - begun)} ms`,
		);
		return timings;
	}

	/** The server is already up, so a service that fails to start takes the app down with it. */
	private async startHostedServicesAfterListen(): Promise<
		readonly HostedServiceStartTiming[]
	> {
		try {
			return await this.startHostedServices();
		} catch (startError) {
			try {
				await this.dispose();
			} catch (stopError) {
				throw new AggregateError(
					[startError, stopError],
					"A hosted service failed to start, and stopping the app failed too",
				);
			}
			throw startError;
		}
	}

	public [Symbol.asyncDispose]() {
		// The container holds this App too; when stop() disposes the container it lands
		// here, and awaiting our own shutdown would deadlock.
		if (this.disposingContainer) return Promise.resolve();
		return this.dispose();
	}

	/** Stop the app. Calling it again (or from a signal) returns the same shutdown. */
	public dispose(): Promise<void> {
		this.disposing ??= this.stop();
		return this.disposing;
	}

	private async stop(): Promise<void> {
		// Removed first, so a second Ctrl+C / SIGTERM gets Node's default: exit now.
		this.removeSignalHandlers();
		this.logger.info("Stopping");
		// Hosted services hear the signal at once, so background work winds down while the server drains.
		this.hostedServices?.abort();
		try {
			// The server first: in-flight requests still need the services (DB pools etc.) that
			// disposing the container would close.
			await this.server?.stop();
			// Hosted services next, while what they use is still open.
			await this.hostedServices?.stop();
		} finally {
			this.disposingContainer = true;
			await this.container[Symbol.asyncDispose]();
			await scribe.stop();
		}
	}

	private stopOnSignals(options?: StartOptions) {
		const signals = options?.shutdownSignals ?? DEFAULT_SHUTDOWN_SIGNALS;
		const timeoutMs = options?.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
		if (signals === false || signals.length === 0) return;
		this.signalHandler = (signal) => {
			this.logger.info(`Received ${signal}; finishing in-flight requests`);
			// console.error, not the logger: scribe may be the thing that's stuck.
			const timer = setTimeout(() => {
				console.error(`Shutdown did not finish within ${timeoutMs}ms; exiting.`);
				process.exit(1);
			}, timeoutMs);
			timer.unref();
			this.dispose().then(
				() => clearTimeout(timer),
				(error: unknown) => {
					clearTimeout(timer);
					console.error("Shutdown failed:", error);
					process.exit(1);
				},
			);
		};
		this.shutdownSignals = signals;
		for (const signal of signals) process.on(signal, this.signalHandler);
	}

	private removeSignalHandlers() {
		if (!this.signalHandler) return;
		for (const signal of this.shutdownSignals) process.off(signal, this.signalHandler);
	}

	private async getPort(options?: StartOptions) {
		const port =
			options?.port ??
			(await this.configurationService?.get(ApiConfiguration))?.port ??
			DEFAULT_PORT;

		return port;
	}
}
