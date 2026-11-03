import { describe, expect, it } from "vitest";
import { collections } from "../../src/collections/index.js";

describe("unique-objects functions", () => {
	describe("uniqueObjectsByKey", () => {
		it("should remove duplicate objects based on key property", () => {
			const items = [
				{ id: 1, name: "Alice" },
				{ id: 2, name: "Bob" },
				{ id: 1, name: "Alice Duplicate" },
			];
			const result = collections.uniqueObjectsByKey(items, "id");
			expect(result).toHaveLength(2);
			expect(result[0]).toEqual({ id: 1, name: "Alice Duplicate" });
			expect(result[1]).toEqual({ id: 2, name: "Bob" });
		});

		it("should keep last occurrence when duplicates exist", () => {
			const items = [
				{ id: 1, value: "first" },
				{ id: 1, value: "second" },
				{ id: 1, value: "third" },
			];
			const result = collections.uniqueObjectsByKey(items, "id");
			expect(result).toHaveLength(1);
			expect(result[0].value).toBe("third");
		});

		it("should handle empty array", () => {
			const items: { id: number }[] = [];
			const result = collections.uniqueObjectsByKey(items, "id");
			expect(result).toEqual([]);
		});

		it("should handle array with single item", () => {
			const items = [{ id: 1, name: "Alice" }];
			const result = collections.uniqueObjectsByKey(items, "id");
			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({ id: 1, name: "Alice" });
		});

		it("should handle all unique items", () => {
			const items = [
				{ id: 1, name: "Alice" },
				{ id: 2, name: "Bob" },
				{ id: 3, name: "Charlie" },
			];
			const result = collections.uniqueObjectsByKey(items, "id");
			expect(result).toHaveLength(3);
			expect(result).toEqual(items);
		});

		it("should work with different property types", () => {
			const items = [
				{ code: "A", value: 1 },
				{ code: "B", value: 2 },
				{ code: "A", value: 3 },
			];
			const result = collections.uniqueObjectsByKey(items, "code");
			expect(result).toHaveLength(2);
			expect(result[0].code).toBe("A");
			expect(result[1].code).toBe("B");
		});

		it("should handle null items gracefully", () => {
			const items: Array<{ id: number; name: string } | null> = [
				{ id: 1, name: "Alice" },
				null,
				{ id: 2, name: "Bob" },
			];
			const result = collections.uniqueObjectsByKey(items, "id");
			expect(result).toHaveLength(3);
			expect(result[0]).toEqual({ id: 1, name: "Alice" });
			expect(result[1]).toBe(null);
			expect(result[2]).toEqual({ id: 2, name: "Bob" });
		});

		it("should group multiple null items together", () => {
			const items: Array<{ id: number; name: string } | null> = [
				{ id: 1, name: "Alice" },
				null,
				{ id: 2, name: "Bob" },
				null,
				null,
			];
			const result = collections.uniqueObjectsByKey(items, "id");
			expect(result).toHaveLength(3);
			expect(result.filter((item) => item === null)).toHaveLength(1);
			expect(result[0]).toEqual({ id: 1, name: "Alice" });
			expect(result[1]).toBe(null);
			expect(result[2]).toEqual({ id: 2, name: "Bob" });
		});

		it("should handle undefined items gracefully", () => {
			const items: Array<{ id: number; name: string } | undefined> = [
				{ id: 1, name: "Alice" },
				undefined,
				{ id: 2, name: "Bob" },
			];
			const result = collections.uniqueObjectsByKey(items, "id");
			expect(result).toHaveLength(3);
		});

		it("should handle numeric keys", () => {
			const items = [
				{ count: 5, label: "first" },
				{ count: 10, label: "second" },
				{ count: 5, label: "third" },
			];
			const result = collections.uniqueObjectsByKey(items, "count");
			expect(result).toHaveLength(2);
			expect(result[0].count).toBe(5);
			expect(result[1].count).toBe(10);
		});

		it("should handle boolean keys", () => {
			const items = [
				{ active: true, id: 1 },
				{ active: false, id: 2 },
				{ active: true, id: 3 },
			];
			const result = collections.uniqueObjectsByKey(items, "active");
			expect(result).toHaveLength(2);
			expect(result[0].active).toBe(true);
			expect(result[1].active).toBe(false);
		});
	});

	describe("uniqueObjectsBy", () => {
		it("should remove duplicates using custom selector function", () => {
			const items = [
				{ firstName: "Alice", lastName: "Smith" },
				{ firstName: "Bob", lastName: "Jones" },
				{ firstName: "Alice", lastName: "Brown" },
			];
			const result = collections.uniqueObjectsBy(items, (obj) => obj.firstName);
			expect(result).toHaveLength(2);
			expect(result[0].firstName).toBe("Alice");
			expect(result[1].firstName).toBe("Bob");
		});

		it("should handle complex key generation", () => {
			const items = [
				{ firstName: "Alice", lastName: "Smith" },
				{ firstName: "Bob", lastName: "Jones" },
				{ firstName: "Alice", lastName: "Smith" },
			];
			const result = collections.uniqueObjectsBy(
				items,
				(obj) => `${obj.firstName}-${obj.lastName}`,
			);
			expect(result).toHaveLength(2);
		});

		it("should keep last occurrence when duplicates exist", () => {
			const items = [
				{ id: 1, category: "A", value: "first" },
				{ id: 2, category: "A", value: "second" },
				{ id: 3, category: "B", value: "third" },
			];
			const result = collections.uniqueObjectsBy(items, (obj) => obj.category);
			expect(result).toHaveLength(2);
			expect(result[0].value).toBe("second");
			expect(result[1].value).toBe("third");
		});

		it("should handle empty array", () => {
			const items: { id: number }[] = [];
			const result = collections.uniqueObjectsBy(items, (obj) => String(obj.id));
			expect(result).toEqual([]);
		});

		it("should handle array with single item", () => {
			const items = [{ id: 1, name: "Alice" }];
			const result = collections.uniqueObjectsBy(items, (obj) => String(obj.id));
			expect(result).toHaveLength(1);
			expect(result[0]).toEqual({ id: 1, name: "Alice" });
		});

		it("should handle all unique items", () => {
			const items = [
				{ id: 1, name: "Alice" },
				{ id: 2, name: "Bob" },
				{ id: 3, name: "Charlie" },
			];
			const result = collections.uniqueObjectsBy(items, (obj) => String(obj.id));
			expect(result).toHaveLength(3);
			expect(result).toEqual(items);
		});

		it("should work with transformed values", () => {
			const items = [
				{ email: "Alice@Example.com" },
				{ email: "bob@example.com" },
				{ email: "alice@example.com" },
			];
			const result = collections.uniqueObjectsBy(items, (obj) => obj.email.toLowerCase());
			expect(result).toHaveLength(2);
		});

		it("should handle complex object transformations", () => {
			const items = [
				{ x: 1, y: 2 },
				{ x: 3, y: 4 },
				{ x: 1, y: 2 },
			];
			const result = collections.uniqueObjectsBy(items, (obj) => `${obj.x},${obj.y}`);
			expect(result).toHaveLength(2);
		});

		it("should handle numeric return from selector", () => {
			const items = [
				{ id: 1, value: 100 },
				{ id: 2, value: 200 },
				{ id: 3, value: 100 },
			];
			const result = collections.uniqueObjectsBy(items, (obj) => String(obj.value));
			expect(result).toHaveLength(2);
		});

		it("should deduplicate based on computed values", () => {
			const items = [
				{ price: 10, quantity: 2 },
				{ price: 5, quantity: 4 },
				{ price: 20, quantity: 1 },
			];
			const result = collections.uniqueObjectsBy(items, (obj) =>
				String(obj.price * obj.quantity),
			);
			expect(result).toHaveLength(1); // All have total of 20
		});
	});
});
