import { describe, expect, it } from "vitest";
import { collections } from "../../src/collections/index.js";

describe("merge-arrays functions", () => {
	describe("mergeBy", () => {
		it("should merge arrays and prefer second array values for duplicate keys", () => {
			const first = [
				{ id: "build", value: "default-build" },
				{ id: "lint", value: "default-lint" },
			];
			const second = [
				{ id: "build", value: "custom-build" },
				{ id: "test", value: "custom-test" },
			];

			const result = collections.mergeBy(first, second, (item) => item.id);

			expect(result).toEqual([
				{ id: "build", value: "custom-build" },
				{ id: "lint", value: "default-lint" },
				{ id: "test", value: "custom-test" },
			]);
		});

		it("should return an empty array when both arrays are empty", () => {
			expect(collections.mergeBy([], [], () => "")).toEqual([]);
		});
	});

	describe("mergeByKey", () => {
		it("should merge arrays by key and prefer second array values", () => {
			const first = [
				{ name: "build", order: 1 },
				{ name: "lint", order: 2 },
			];
			const second = [
				{ name: "build", order: 100 },
				{ name: "test", order: 3 },
			];

			const result = collections.mergeByKey(first, second, "name");

			expect(result).toEqual([
				{ name: "build", order: 100 },
				{ name: "lint", order: 2 },
				{ name: "test", order: 3 },
			]);
		});
	});
});
