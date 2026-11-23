import { scribe } from "@decohere/scribe";
import type { IContainer } from "../composition/index.js";
import type { Constructable } from "../reflection/index.js";
import type { StartStep } from "./const.js";
import type { IReadinessCheck } from "./readiness.types.js";
import type { HostedService } from "./hosted-service.js";

/**
 * How long one start step or hosted service took to start the first time: running the step, or
 * resolving the service from the container plus its `start()`. `started` is false when that
 * threw and it is being retried.
 */
export type HostedServiceStartTiming = { name: string; ms: number; started: boolean };

/**
 * How a start step or hosted service that throws is started again: after `initialMs` (default
 * 1 s), doubling up to `maxMs` (default 60 s), each wait varied by ±20% so instances don't retry
 * in step.
 */
export type StartRetry = { initialMs?: number; maxMs?: number };

const DEFAULT_RETRY_INITIAL_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 60_000;

/** A start step and the name its logs and readiness use. */
type NamedStep = { name: string; run: StartStep };

/** Something whose start failed, until a retry succeeds. */
type Failing = { name: string; error: unknown; waitMs: number };

/**
 * Starts and stops the app's start steps and {@link HostedService}s. One per app; the builder adds
 * them (`registerStartStep`, `withHostedService`) and `App` drives it.
 *
 * Steps run first, in order, then services, in order. Either may throw: it is retried with
 * backoff while the app runs. A failed step holds back everything after it until it succeeds,
 * since what follows may need what it does (a database's migrations); a failed service holds back
 * nothing.
 */
export class HostedServiceHost {
	private readonly logger = scribe.logger(HostedServiceHost.name);
	private readonly steps: NamedStep[] = [];
	private readonly types: Constructable<HostedService>[] = [];
	private readonly controller = new AbortController();
	/** In start order; stopped in reverse. */
	private readonly started: HostedService[] = [];
	private readonly _timings: HostedServiceStartTiming[] = [];
	private readonly failing = new Map<object, Failing>();
	/** Background work (retries, and a start resumed after a step's retry), so a stop waits for it. */
	private readonly background = new Set<Promise<void>>();
	/** Starts running now: the first, and any resumed after a failed step's retry. */
	private running = 0;
	private starting: Promise<void> | undefined;
	private stopping: Promise<void> | undefined;

	public add(...types: Constructable<HostedService>[]) {
		this.types.push(...types);
	}

	/** Run `step` before every hosted service, after the steps added before it. */
	public addStep(step: StartStep, name?: string) {
		const fallback = step.name || `start step ${this.steps.length + 1}`;
		this.steps.push({ name: name ?? fallback, run: step });
	}

	/** How many steps and services there are. */
	public get size(): number {
		return this.steps.length + this.types.length;
	}

	public get isEmpty(): boolean {
		return this.types.length === 0 && this.steps.length === 0;
	}

	/**
	 * Run the steps, then start the services, and resolve once each has started or, having thrown,
	 * is being retried in the background with `retry`'s backoff. With `retry: false`, a throw stops
	 * the services already started and is rethrown. Stops launching more once {@link stop} has
	 * begun.
	 */
	public start(container: IContainer, retry: StartRetry | false = {}): Promise<void> {
		this.starting ??= this.run(() => this.startFrom(container, retry, 0));
		return this.starting;
	}

	/** Abort the services' signal: background work should wind down. {@link stop} does this too. */
	public abort() {
		this.controller.abort();
	}

	/**
	 * Abort the signal, wait for starts and retries still in progress, then stop the started
	 * services in reverse order. Every `stop()` runs even if one throws; the failures are rethrown
	 * after.
	 */
	public stop(): Promise<void> {
		this.stopping ??= this.stopAll();
		return this.stopping;
	}

	/** Each step's and service's first start, in start order. */
	public get timings(): readonly HostedServiceStartTiming[] {
		return [...this._timings];
	}

	/**
	 * For `GET /ready`: while a start is under way, one check that fails (the app listened before
	 * its services started); one failing check per step or service being retried; then the
	 * started services that report readiness.
	 */
	public readinessChecks(): IReadinessCheck[] {
		const checks: IReadinessCheck[] = [];
		if (this.running > 0) {
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
			if (typeof service.check !== "function") {
				continue;
			}
			checks.push({
				name: service.constructor.name,
				check: () => service.check?.() ?? Promise.resolve(),
			});
		}
		return checks;
	}

	/** Counted in {@link running} while it runs, so `/ready` fails meanwhile. */
	private async run(start: () => Promise<void>) {
		this.running += 1;
		try {
			await start();
		} finally {
			this.running -= 1;
		}
	}

	/** Run the steps from `stepIndex`, then start every service. */
	private async startFrom(
		container: IContainer,
		retry: StartRetry | false,
		stepIndex: number,
	) {
		const { signal } = this.controller;
		for (let index = stepIndex; index < this.steps.length; index++) {
			if (signal.aborted) {
				return;
			}
			const step = this.steps[index];
			const begun = performance.now();
			try {
				await step.run(container);
			} catch (error) {
				this.record(step.name, begun, false);
				if (retry === false) {
					this.logger.error(`Start step ${step.name} failed`, error);
					return this.failFast(error);
				}
				// What follows waits: it may need what this step does.
				const resume = () =>
					this.inBackground(this.run(() => this.startFrom(container, retry, index + 1)));
				this.retryLater(step, step.name, error, retry, () => step.run(container), resume);
				return;
			}
			this.record(step.name, begun, true);
		}
		for (const type of this.types) {
			if (signal.aborted) {
				return;
			}
			const begun = performance.now();
			const service = container.resolve(type);
			try {
				await service.start(signal);
			} catch (error) {
				this.record(type.name, begun, false);
				if (retry === false) {
					this.logger.error(`Hosted service ${type.name} failed to start`, error);
					return this.failFast(error);
				}
				const attempt = () => service.start(signal);
				// Pushed even if the app is stopping: the stop waits for this retry, then stops it.
				const onStarted = () => this.started.push(service);
				this.retryLater(service, type.name, error, retry, attempt, onStarted);
				continue;
			}
			this.started.push(service);
			this.record(type.name, begun, true);
		}
	}

	private record(name: string, begun: number, started: boolean) {
		const ms = Math.round(performance.now() - begun);
		this._timings.push({ name, ms, started });
		if (started) {
			this.logger.debug(`${name} started in ${ms} ms`);
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

	/**
	 * Call `attempt` again with backoff until it succeeds, then `onStarted`. Listed in `/ready`
	 * meanwhile. Stops when the app stops.
	 */
	private retryLater(
		key: object,
		name: string,
		error: unknown,
		retry: StartRetry,
		attempt: () => Promise<void> | void,
		onStarted: () => void,
	) {
		const { signal } = this.controller;
		const maxMs = retry.maxMs ?? DEFAULT_RETRY_MAX_MS;
		const initialMs = retry.initialMs ?? DEFAULT_RETRY_INITIAL_MS;
		const failing: Failing = { name, error, waitMs: initialMs };
		this.failing.set(key, failing);
		this.logger.error(
			`${name} failed to start; retrying in about ${failing.waitMs} ms`,
			error,
		);

		const tryAgain = async () => {
			try {
				await attempt();
			} catch (attemptError) {
				failing.error = attemptError;
				if (signal.aborted) {
					this.failing.delete(key);
					this.logger.warn(`${name} failed to start as the app stopped`, attemptError);
					return;
				}
				failing.waitMs = Math.min(failing.waitMs * 2, maxMs);
				this.logger.warn(
					`${name} still failing to start; retrying in about ${failing.waitMs} ms: ${describe(attemptError)}`,
				);
				schedule();
				return;
			}
			this.failing.delete(key);
			this.logger.info(`${name} started after retrying`);
			onStarted();
		};

		const schedule = () => {
			if (signal.aborted) {
				return;
			}
			const cancel = () => clearTimeout(timer);
			const timer = setTimeout(
				() => {
					signal.removeEventListener("abort", cancel);
					this.inBackground(tryAgain());
				},
				failing.waitMs * (0.8 + Math.random() * 0.4),
			);
			signal.addEventListener("abort", cancel, { once: true });
		};
		schedule();
	}

	/** Track `work` so a stop waits for it. It must not reject: each caller handles its own errors. */
	private inBackground(work: Promise<void>) {
		this.background.add(work);
		void work.finally(() => this.background.delete(work));
	}

	private async stopAll() {
		this.controller.abort();
		this.failing.clear();
		await Promise.allSettled([this.starting]);
		// A retry that finishes now may resume a start, which adds more work: wait until none is left.
		while (this.background.size > 0) {
			await Promise.allSettled(this.background);
		}
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
		if (failures.length === 1) {
			throw failures[0];
		}
		if (failures.length > 1) {
			throw new AggregateError(failures, `${failures.length} hosted services failed to stop`);
		}
	}
}

function describe(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
