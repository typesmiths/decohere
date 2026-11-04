/** A listener's handle: `unsubscribe` stops it receiving values. */
export type Subscription = { unsubscribe(): void };

/** The listening side of a {@link Subject}: what a class exposes so callers can't emit. */
export type Observable<T> = {
	subscribe(listener: (value: T) => void): Subscription;
};

/**
 * Sends each value to every current listener, synchronously and in subscription order.
 * The part of rxjs's `Subject` the tools used, without loading rxjs on every start.
 */
export class Subject<T> implements Observable<T> {
	readonly #listeners = new Set<{ listener: (value: T) => void }>();

	public subscribe(listener: (value: T) => void): Subscription {
		// An entry per call, so the same function subscribed twice is two listeners.
		const entry = { listener };
		this.#listeners.add(entry);
		return { unsubscribe: () => this.#listeners.delete(entry) };
	}

	/** Calls every listener; one that throws doesn't stop the rest, and its error is rethrown. */
	public next(value: T): void {
		const errors: unknown[] = [];
		// A copy: a listener subscribed while this runs gets the next value, not this one.
		for (const { listener } of Array.from(this.#listeners)) {
			try {
				listener(value);
			} catch (error) {
				errors.push(error);
			}
		}
		if (errors.length === 1) throw errors[0];
		if (errors.length > 1) throw new AggregateError(errors, "Subject listeners threw");
	}

	public asObservable(): Observable<T> {
		return { subscribe: (listener) => this.subscribe(listener) };
	}
}
