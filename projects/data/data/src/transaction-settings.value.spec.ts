import { describe, expect, it } from "vitest";
import { InvalidTransactionSettingError } from "./invalid-transaction-setting.error.js";
import { TransactionSettings } from "./transaction-settings.value.js";

describe("TransactionSettings", () => {
	it("keeps the app's own settings, named prefix.name, in the order given", () => {
		const settings = TransactionSettings.of({ "app.club_id": "c1", "app.account_id": "a1" });
		expect(settings.entries()).toEqual([
			["app.club_id", "c1"],
			["app.account_id", "a1"],
		]);
		expect(settings.isEmpty).toBe(false);
	});

	it("is empty when given nothing", () => {
		expect(TransactionSettings.of({}).isEmpty).toBe(true);
		expect(TransactionSettings.none.entries()).toEqual([]);
	});

	it.each([
		"search_path",
		"role",
		"app",
		"app.",
		".club_id",
		"app.club-id",
		"app.club_id; drop",
	])("refuses %j, which isn't a setting of the app's own", (name) => {
		expect(() => TransactionSettings.of({ [name]: "x" })).toThrow(
			InvalidTransactionSettingError,
		);
	});
});
