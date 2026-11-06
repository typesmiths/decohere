import { expect, it } from "vitest";

it("fails on purpose to check the failure report", () => {
	expect("deliberate failure").toBe("the failure report should show this");
});
