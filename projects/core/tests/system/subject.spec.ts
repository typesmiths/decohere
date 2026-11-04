import { describe, expect, it } from "vitest";
import { Subject } from "../../src/system/subject.js";

describe("Subject", () => {
	it("sends each value to every listener, in the order they subscribed", () => {
		const subject = new Subject<number>();
		const seen: string[] = [];
		subject.subscribe((value) => seen.push(`a${value}`));
		subject.subscribe((value) => seen.push(`b${value}`));

		subject.next(1);
		subject.next(2);

		expect(seen).toEqual(["a1", "b1", "a2", "b2"]);
	});

	it("stops sending to a listener once it unsubscribes", () => {
		const subject = new Subject<number>();
		const seen: number[] = [];
		const subscription = subject.subscribe((value) => seen.push(value));

		subject.next(1);
		subscription.unsubscribe();
		subject.next(2);

		expect(seen).toEqual([1]);
	});

	it("counts the same function subscribed twice as two listeners", () => {
		const subject = new Subject<number>();
		const seen: number[] = [];
		const listener = (value: number) => seen.push(value);
		const first = subject.subscribe(listener);
		subject.subscribe(listener);

		first.unsubscribe();
		subject.next(1);

		expect(seen).toEqual([1]);
	});

	it("still calls the other listeners when one throws, then throws its error", () => {
		const subject = new Subject<number>();
		const seen: number[] = [];
		subject.subscribe(() => {
			throw new Error("boom");
		});
		subject.subscribe((value) => seen.push(value));

		expect(() => subject.next(1)).toThrow("boom");
		expect(seen).toEqual([1]);
	});

	it("throws every error when more than one listener throws", () => {
		const subject = new Subject<number>();
		subject.subscribe(() => {
			throw new Error("first");
		});
		subject.subscribe(() => {
			throw new Error("second");
		});

		expect(() => subject.next(1)).toThrow(AggregateError);
	});

	it("hands out a listen-only view that cannot emit", () => {
		const subject = new Subject<number>();
		const seen: number[] = [];
		const observable = subject.asObservable();
		observable.subscribe((value) => seen.push(value));

		subject.next(1);

		expect(seen).toEqual([1]);
		expect("next" in observable).toBe(false);
	});
});
