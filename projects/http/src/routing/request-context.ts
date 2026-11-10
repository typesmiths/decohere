import { AsyncLocalStorage } from "node:async_hooks";

/** What the app knows about the request it is serving now. */
export type RequestContext = {
	/** The request's `x-request-id`: the client's, or one generated for it. */
	readonly requestId: string;
	/** The authenticated principal's `sub`, once auth has checked the request. */
	principalId?: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `work`, and everything it awaits, inside `context`. */
function run<T>(context: RequestContext, work: () => T): T {
	return storage.run(context, work);
}

/** The request being served by the code that calls this, or `undefined` outside one. */
function getCurrent(): RequestContext | undefined {
	return storage.getStore();
}

/**
 * Run each step of `stream` inside `context`. A stream's producer runs when its reader asks
 * for the next item, after the handler has returned, so it would otherwise run outside the
 * request.
 */
function bindStream<T>(context: RequestContext, stream: AsyncIterable<T>): AsyncIterable<T> {
	return {
		[Symbol.asyncIterator]() {
			const iterator = stream[Symbol.asyncIterator]();
			return {
				next: (...args: [] | [unknown]) => storage.run(context, () => iterator.next(...args)),
				return: (value?: unknown) =>
					storage.run(context, () =>
						iterator.return == null
							? Promise.resolve({ done: true as const, value: value as T })
							: iterator.return(value),
					),
				throw: (error?: unknown) =>
					storage.run(context, () =>
						iterator.throw == null ? Promise.reject(error) : iterator.throw(error),
					),
			};
		},
	};
}

/** The context as log fields, for `scribe.addContextSource`. */
function getLogFields(): Record<string, unknown> | undefined {
	const context = storage.getStore();
	if (context == null) {
		return undefined;
	}
	return context.principalId == null
		? { requestId: context.requestId }
		: { requestId: context.requestId, principalId: context.principalId };
}

export const requestContext = { run, bindStream, getCurrent, getLogFields };
