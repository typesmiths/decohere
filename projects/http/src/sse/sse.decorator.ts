import type { FunctionType } from "@decohere/core/reflection";
import { defineArgumentMeta, defineMeta } from "@decohere/core/reflection";
import { MetadataKeys } from "../const.js";
import type { ArgumentMeta, RequestPart } from "../routing/http.types.js";
import type { SseOptions } from "./sse.types.js";

/**
 * Mark a route as a server-sent event stream. The method returns an `AsyncIterable` of
 * {@link SseMessage}s (an `async *` method is the usual shape) and the HTTP package writes it as
 * `text/event-stream`. Auth, validation and middleware run first, exactly as on any route,
 * so an unauthorised caller gets a normal 401/403 and no event is ever sent.
 *
 * Combine with `@Get()` (EventSource only issues GET).
 */
export function Sse(options: SseOptions = {}) {
	return (_target: object, _methodName: string, descriptor: PropertyDescriptor) => {
		defineMeta(MetadataKeys.sse, options, descriptor.value);
	};
}

function injected(location: RequestPart) {
	return () => (target: object, propertyKey: string, parameterIndex: number) => {
		const fn = (target as Record<string, FunctionType>)[propertyKey];
		const meta: ArgumentMeta = {
			argumentIndex: parameterIndex,
			argumentLocation: location,
			mappingKey: undefined,
			pipes: [],
		};
		defineArgumentMeta<ArgumentMeta>(MetadataKeys.parameter, meta, fn, parameterIndex);
	};
}

/**
 * Inject an `AbortSignal` that aborts when the client disconnects or the app stops. Pass it to
 * whatever the producer waits on (timers, subscriptions, queries) so it stops promptly.
 */
export const Signal = injected("signal");

/** Inject the `Last-Event-ID` header the browser sends when it reconnects, or `undefined`. */
export const LastEventId = injected("lastEventId");
