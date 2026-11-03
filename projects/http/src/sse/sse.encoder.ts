import { scribe } from "@decohere/scribe";
import { sseWire } from "./sse.wire.js";

export type SseEncodeOptions = {
	/** Aborted when the client disconnects or the app stops. */
	signal: AbortSignal;
	heartbeatMs: number;
	/**
	 * Called once, as the stream ends, with a promise that settles when the producer has
	 * actually stopped (its `finally` blocks have run).
	 */
	onProducerStopped: (stopped: Promise<void>) => void;
};

const logger = scribe.logger("SseEncoder");

type Step =
	| { kind: "item"; result: IteratorResult<unknown> }
	| { kind: "heartbeat" }
	| { kind: "abort" };

/**
 * Turn the handler's events into SSE text. Writes an opening comment so the browser sees the
 * response headers at once, a heartbeat whenever the producer is quiet, and stops as soon as the
 * signal aborts, without waiting for a producer that is stuck.
 */
export async function* encodeSse(
	source: AsyncIterable<unknown>,
	options: SseEncodeOptions,
): AsyncGenerator<string> {
	const { signal, heartbeatMs } = options;
	const iterator = source[Symbol.asyncIterator]();
	let onAbort: (() => void) | undefined;
	const abortStep = new Promise<Step>((resolve) => {
		onAbort = () => resolve({ kind: "abort" });
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
	});
	let pending: Promise<Step> | undefined;
	try {
		yield sseWire.formatComment("open");
		while (!signal.aborted) {
			pending ??= iterator.next().then((result): Step => ({ kind: "item", result }));
			let timer: NodeJS.Timeout | undefined;
			const steps: Promise<Step>[] = [pending, abortStep];
			if (heartbeatMs > 0) {
				steps.push(
					new Promise<Step>((resolve) => {
						timer = setTimeout(() => resolve({ kind: "heartbeat" }), heartbeatMs);
					}),
				);
			}
			let step: Step;
			try {
				step = await Promise.race(steps);
			} finally {
				clearTimeout(timer);
			}
			if (step.kind === "abort") return;
			if (step.kind === "heartbeat") {
				yield sseWire.formatComment("heartbeat");
				continue;
			}
			pending = undefined;
			if (step.result.done) return;
			yield sseWire.formatMessage(step.result.value);
		}
	} catch (error) {
		// Headers are already sent, so the only honest thing left is to log and end the stream.
		if (!signal.aborted) logger.error("SSE producer failed", error);
	} finally {
		if (onAbort) signal.removeEventListener("abort", onAbort);
		// If the producer has not answered its last `next()`, `return()` waits behind it. That is
		// why handlers must pass the signal to whatever they wait on.
		options.onProducerStopped(
			Promise.resolve()
				.then(() => iterator.return?.())
				.then(
					() => undefined,
					(error: unknown) => {
						if (!signal.aborted) logger.error("SSE producer failed while stopping", error);
					},
				),
		);
	}
}
