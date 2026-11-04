import { type LifetimeScope, LifetimeScopeToken } from "@decohere/crucible";
import { inject, optional } from "@decohere/crucible/decorators";
import {
	ConfigurationServiceToken,
	type IConfigurationService,
} from "@decohere/core/configuration";
import { scribe } from "@decohere/scribe";
import { HostedServiceHostToken, HttpProviderToken } from "../const.js";
import type { HostedServiceHost } from "../hosting/hosted-service-host.js";
import type { HttpProvider, StartResponse } from "../routing/http.types.js";

const DEFAULT_PORT = 3000;
const DEFAULT_SHUTDOWN_SIGNALS: readonly NodeJS.Signals[] = ["SIGTERM", "SIGINT"];
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

export class ApiConfiguration {
	public port: number;
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
};

export class App {
	private _addresses = Array.of<string>();
	private logger = scribe.logger(App.name);
	private disposing: Promise<void> | undefined;
	private disposingContainer = false;
	private signalHandler: ((signal: NodeJS.Signals) => void) | undefined;
	private shutdownSignals: readonly NodeJS.Signals[] = [];

	public constructor(
		@inject(LifetimeScopeToken) private readonly container: LifetimeScope,
		@inject(ConfigurationServiceToken)
		@optional()
		private configurationService?: IConfigurationService,
		@inject(HttpProviderToken) @optional() private httpProvider?: HttpProvider,
		@inject(HostedServiceHostToken) @optional() private hostedServices?: HostedServiceHost,
	) {}

	public get addresses(): readonly string[] {
		return this._addresses;
	}

	public async start(options?: StartOptions): Promise<StartResponse> {
		this.logger.info("Starting app");
		// Before HTTP, so a request never reaches a service that has not started.
		await this.hostedServices?.start(this.container);
		// The app was stopped while a hosted service was still starting.
		if (this.disposing != null) return;
		const hasHostedServices = this.hostedServices != null && !this.hostedServices.isEmpty;
		if (!this.httpProvider) {
			if (hasHostedServices) this.stopOnSignals(options);
			return;
		}
		const port = await this.getPort(options);
		this.logger.info(`Starting http on port ${port}`);
		const startResponse = await this.httpProvider?.start({
			port,
			...(options?.host != null ? { host: options.host } : {}),
		});
		this._addresses = [...startResponse.addresses];
		this.logger.info("Listening on:", this._addresses);
		this.stopOnSignals(options);
		return startResponse;
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
		// Hosted services hear the signal at once, so background work winds down while HTTP drains.
		this.hostedServices?.abort();
		try {
			// HTTP first: in-flight requests still need the services (DB pools etc.) that
			// disposing the container would close.
			await this.httpProvider?.stop();
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
