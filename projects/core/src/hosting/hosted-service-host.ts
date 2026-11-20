import { scribe } from "@decohere/scribe";
import type { IContainer } from "../composition/index.js";
import type { Constructable } from "../reflection/index.js";
import type { IReadinessCheck } from "./readiness.types.js";
import type { HostedService } from "./hosted-service.js";

/** How long one hosted service took to start: resolving it from the container plus its `start()`. */
export type HostedServiceStartTiming = { name: string; ms: number };

/**
 * Starts and stops the app's {@link HostedService}s. One per app; `Builder.withHostedService`
 * adds the types and `App` drives it.
 */
export class HostedServiceHost {
	private readonly logger = scribe.logger(HostedServiceHost.name);
	private readonly types: Constructable<HostedService>[] = [];
	private readonly controller = new AbortController();
	/** In start order; stopped in reverse. */
	private readonly started: HostedService[] = [];
	private readonly _timings: HostedServiceStartTiming[] = [];
	private starting: Promise<void> | undefined;
	private startSettled = false;
	private stopping: Promise<void> | undefined;

	public add(...types: Constructable<HostedService>[]) {
		this.types.push(...types);
	}

	public get isEmpty(): boolean {
		return this.types.length === 0;
	}

	/**
	 * Start every service in registration order. If one throws, the ones already started are
	 * stopped and the error is rethrown. Stops launching more once {@link stop} has begun.
	 */
	public start(container: IContainer): Promise<void> {
		this.starting ??= this.startAll(container);
		return this.starting;
	}

	/** Abort the services' signal: background work should wind down. {@link stop} does this too. */
	public abort() {
		this.controller.abort();
	}

	/**
	 * Abort the signal, wait for a start still in progress, then stop the started services in
	 * reverse order. Every `stop()` runs even if one throws; the failures are rethrown after.
	 */
	public stop(): Promise<void> {
		this.stopping ??= this.stopAll();
		return this.stopping;
	}

	/** Each started service's start time, in start order. */
	public get timings(): readonly HostedServiceStartTiming[] {
		return [...this._timings];
	}

	/**
	 * For `GET /ready`: while a start is under way, one check that fails (the app listened before
	 * its services started); then the started services that report readiness.
	 */
	public readinessChecks(): IReadinessCheck[] {
		const checks: IReadinessCheck[] = [];
		if (this.starting != null && !this.startSettled) {
			checks.push({
				name: "hosted services starting",
				check: () => Promise.reject(new Error("hosted services are still starting")),
			});
		}
		for (const service of this.started) {
			if (typeof service.check !== "function") continue;
			checks.push({
				name: service.constructor.name,
				check: () => service.check?.() ?? Promise.resolve(),
			});
		}
		return checks;
	}

	private async startAll(container: IContainer) {
		try {
			await this.startEach(container);
		} finally {
			this.startSettled = true;
		}
	}

	private async startEach(container: IContainer) {
		const { signal } = this.controller;
		for (const type of this.types) {
			if (signal.aborted) return;
			const begun = performance.now();
			const service = container.resolve(type);
			try {
				await service.start(signal);
			} catch (error) {
				this.logger.error(`Hosted service ${type.name} failed to start`, error);
				// Not stop(): it waits for this start to settle.
				this.controller.abort();
				await this.stopStarted().catch(() => {});
				throw error;
			}
			this.started.push(service);
			const ms = Math.round(performance.now() - begun);
			this._timings.push({ name: type.name, ms });
			this.logger.debug(`Hosted service ${type.name} started in ${ms} ms`);
		}
	}

	private async stopAll() {
		this.controller.abort();
		await Promise.allSettled([this.starting]);
		await this.stopStarted();
	}

	/** Stop what is started, newest first. Takes each service off the list, so it runs once. */
	private async stopStarted() {
		const failures: unknown[] = [];
		for (let service = this.started.pop(); service != null; service = this.started.pop()) {
			try {
				await service.stop?.();
			} catch (error) {
				this.logger.error(`Hosted service ${service.constructor.name} failed to stop`, error);
				failures.push(error);
			}
		}
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) {
			throw new AggregateError(failures, `${failures.length} hosted services failed to stop`);
		}
	}
}
