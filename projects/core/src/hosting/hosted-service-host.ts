import { scribe } from "@decohere/scribe";
import type { IContainer } from "../composition/index.js";
import type { Constructable } from "../reflection/index.js";
import type { IReadinessCheck } from "./readiness.types.js";
import type { HostedService } from "./hosted-service.js";

/**
 * How long one hosted service's first start took: resolving it from the container plus its
 * `start()`. `started` is false when that start threw and the service is being retried.
 */
export type HostedServiceStartTiming = { name: string; ms: number; started: boolean };

/**
 * How a hosted service whose `start()` throws is started again: after `initialMs` (default 1 s),
 * doubling up to `maxMs` (default 60 s), each wait varied by ±20% so instances don't retry in step.
 */
export type StartRetry = { initialMs?: number; maxMs?: number };

const DEFAULT_RETRY_INITIAL_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 60_000;

/** A service whose start failed, until a retry succeeds. */
type Failing = { name: string; error: unknown; waitMs: number };

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
	private readonly failing = new Map<HostedService, Failing>();
	/** Retries under way, so a stop waits for them. */
	private readonly retrying = new Set<Promise<void>>();
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
	 * Start every service in registration order, and resolve once each has started or, its
	 * `start()` having thrown, is being retried in the background with `retry`'s backoff. With
	 * `retry: false`, a throw stops the ones already started and is rethrown. Stops launching more
	 * once {@link stop} has begun.
	 */
	public start(container: IContainer, retry: StartRetry | false = {}): Promise<void> {
		this.starting ??= this.startAll(container, retry);
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

	/** Each service's first start, in start order. */
	public get timings(): readonly HostedServiceStartTiming[] {
		return [...this._timings];
	}

	/**
	 * For `GET /ready`: while a start is under way, one check that fails (the app listened before
	 * its services started); one failing check per service being retried; then the started
	 * services that report readiness.
	 */
	public readinessChecks(): IReadinessCheck[] {
		const checks: IReadinessCheck[] = [];
		if (this.starting != null && !this.startSettled) {
			checks.push({
				name: "hosted services starting",
				check: () => Promise.reject(new Error("hosted services are still starting")),
			});
		}
		for (const { name, error, waitMs } of this.failing.values()) {
			const reason = `failed to start, retrying within ${Math.round(waitMs * 1.2)} ms: ${describe(error)}`;
			checks.push({ name, check: () => Promise.reject(new Error(reason)) });
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

	private async startAll(container: IContainer, retry: StartRetry | false) {
		try {
			await this.startEach(container, retry);
		} finally {
			this.startSettled = true;
		}
	}

	private async startEach(container: IContainer, retry: StartRetry | false) {
		const { signal } = this.controller;
		for (const type of this.types) {
			if (signal.aborted) return;
			const begun = performance.now();
			const service = container.resolve(type);
			try {
				await service.start(signal);
			} catch (error) {
				const ms = Math.round(performance.now() - begun);
				this._timings.push({ name: type.name, ms, started: false });
				if (retry === false) {
					this.logger.error(`Hosted service ${type.name} failed to start`, error);
					return this.failFast(error);
				}
				this.retryLater(type.name, service, error, retry);
				continue;
			}
			this.started.push(service);
			const ms = Math.round(performance.now() - begun);
			this._timings.push({ name: type.name, ms, started: true });
			this.logger.debug(`Hosted service ${type.name} started in ${ms} ms`);
		}
	}

	/** Stop what started, then throw the start's error (with the stop's, if that failed too). */
	private async failFast(startError: unknown): Promise<never> {
		// Not stop(): it waits for this start to settle.
		this.controller.abort();
		try {
			await this.stopStarted();
		} catch (stopError) {
			throw new AggregateError(
				[startError, stopError],
				"A hosted service failed to start, and stopping the ones already started failed too",
			);
		}
		throw startError;
	}

	private retryLater(name: string, service: HostedService, error: unknown, retry: StartRetry) {
		const { signal } = this.controller;
		const maxMs = retry.maxMs ?? DEFAULT_RETRY_MAX_MS;
		const failing: Failing = {
			name,
			error,
			waitMs: retry.initialMs ?? DEFAULT_RETRY_INITIAL_MS,
		};
		this.failing.set(service, failing);
		this.logger.error(
			`Hosted service ${name} failed to start; retrying in about ${failing.waitMs} ms`,
			error,
		);

		const attempt = async () => {
			try {
				await service.start(signal);
			} catch (attemptError) {
				failing.error = attemptError;
				if (signal.aborted) {
					this.failing.delete(service);
					this.logger.warn(
						`Hosted service ${name} failed to start as the app stopped`,
						attemptError,
					);
					return;
				}
				failing.waitMs = Math.min(failing.waitMs * 2, maxMs);
				this.logger.warn(
					`Hosted service ${name} still failing to start; retrying in about ${failing.waitMs} ms: ${describe(attemptError)}`,
				);
				schedule();
				return;
			}
			this.failing.delete(service);
			// Pushed even if the app is stopping: the stop waits for this attempt, then stops it.
			this.started.push(service);
			this.logger.info(`Hosted service ${name} started after retrying`);
		};

		const schedule = () => {
			if (signal.aborted) return;
			const cancel = () => clearTimeout(timer);
			const timer = setTimeout(
				() => {
					signal.removeEventListener("abort", cancel);
					const running = attempt();
					this.retrying.add(running);
					void running.finally(() => this.retrying.delete(running));
				},
				failing.waitMs * (0.8 + Math.random() * 0.4),
			);
			signal.addEventListener("abort", cancel, { once: true });
		};
		schedule();
	}

	private async stopAll() {
		this.controller.abort();
		this.failing.clear();
		await Promise.allSettled([this.starting, ...this.retrying]);
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

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
