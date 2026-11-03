import { describe, expect, it } from "vitest";
import { collections } from "../../src/collections/index.js";

describe("sum functions", () => {
	describe("sumByKey", () => {
		it("should sum numeric values from object array using key selector", () => {
			const items = [{ value: 10 }, { value: 20 }, { value: 30 }];
			const result = collections.sumByKey(items, "value");
			expect(result).toBe(60);
		});

		it("should handle empty array", () => {
			const items: { value: number }[] = [];
			const result = collections.sumByKey(items, "value");
			expect(result).toBe(0);
		});

		it("should handle null/undefined items", () => {
			const items: Array<{ value: number } | null | undefined> = [
				{ value: 10 },
				null,
				{ value: 20 },
			];
			const result = collections.sumByKey(items, "value");
			expect(result).toBe(30);
		});

		it("should treat non-numeric values as 0", () => {
			const items: Array<{ value: number | string }> = [
				{ value: 10 },
				{ value: "string" },
				{ value: 20 },
			];
			const result = collections.sumByKey(items, "value");
			expect(result).toBe(30);
		});

		it("should work with different property names", () => {
			const items = [{ price: 5.5 }, { price: 10.25 }, { price: 3.75 }];
			const result = collections.sumByKey(items, "price");
			expect(result).toBe(19.5);
		});
	});

	describe("sumBy", () => {
		it("should sum using custom selector function", () => {
			const items = [
				{ value: 10, multiplier: 2 },
				{ value: 20, multiplier: 3 },
				{ value: 30, multiplier: 1 },
			];
			const result = collections.sumBy(items, (item) => item.value * item.multiplier);
			expect(result).toBe(110); // 10*2 + 20*3 + 30*1
		});

		it("should handle empty array with function selector", () => {
			const items: { value: number }[] = [];
			const result = collections.sumBy(items, (item) => item.value);
			expect(result).toBe(0);
		});

		it("should work with complex calculations", () => {
			const items = [
				{ quantity: 5, price: 10 },
				{ quantity: 3, price: 20 },
				{ quantity: 2, price: 15 },
			];
			const result = collections.sumBy(items, (item) => item.quantity * item.price);
			expect(result).toBe(140); // 5*10 + 3*20 + 2*15
		});

		it("should handle negative values", () => {
			const items = [{ value: 10 }, { value: -5 }, { value: 20 }];
			const result = collections.sumBy(items, (item) => item.value);
			expect(result).toBe(25);
		});

		it("should treat non-numeric function results as 0", () => {
			const items = [{ value: 10 }, { value: 20 }, { value: 30 }];
			const result = collections.sumBy(items, (item) =>
				item.value > 15 ? item.value : ("invalid" as unknown as number),
			);
			expect(result).toBe(50); // Only 20 and 30 are summed
		});
	});
});
