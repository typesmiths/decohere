import type { DataSource, QueryRunner } from "typeorm";
import { describe, expect, it } from "vitest";
import { TypeOrmUnitOfWork } from "../src/unit-of-work.js";

/** A stand-in QueryRunner that records what happens to the connection. */
function fakeRunner(transactionActive: boolean) {
	const events: string[] = [];
	const runner = {
		isTransactionActive: transactionActive,
		isReleased: false,
		async rollbackTransaction() {
			await new Promise((resolve) => setTimeout(resolve, 5));
			events.push("rollback");
			runner.isTransactionActive = false;
		},
		async release() {
			await new Promise((resolve) => setTimeout(resolve, 5));
			events.push("release");
			runner.isReleased = true;
		},
	};
	const dataSource = { createQueryRunner: () => runner as unknown as QueryRunner };
	return { uow: new TypeOrmUnitOfWork(dataSource as unknown as DataSource), runner, events };
}

// A request that failed mid-transaction used to hand its connection back to the pool
// with the transaction still open, and without waiting for the release to finish.
describe("TypeOrmUnitOfWork disposal", () => {
	it("rolls back an unfinished transaction, then releases the connection, and waits for both", async () => {
		const { uow, runner, events } = fakeRunner(true);

		await uow[Symbol.asyncDispose]();

		expect(events).toEqual(["rollback", "release"]);
		expect(runner.isReleased).toBe(true);
	});

	it("only releases when no transaction is open", async () => {
		const { uow, events } = fakeRunner(false);

		await uow[Symbol.asyncDispose]();

		expect(events).toEqual(["release"]);
	});

	it("does nothing when already released", async () => {
		const { uow, runner, events } = fakeRunner(false);
		runner.isReleased = true;

		await uow[Symbol.asyncDispose]();

		expect(events).toEqual([]);
	});
});
