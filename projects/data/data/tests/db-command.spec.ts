import { ServiceContainerBuilder } from "@decohere/crucible";
import {
	type ConnectionInfo,
	db,
	type Migration,
	type MigrationState,
	type MigrationTarget,
	MigrationTargetToken,
	type Migrator,
	type SchemaDiff,
} from "@decohere/data";
import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const connection = (name: string): ConnectionInfo => ({
	name,
	provider: "postgres",
	host: "127.0.0.1",
	port: 5432,
	database: name,
	username: `${name}_app`,
	password: "pw",
	synchronize: false,
	seed: false,
});

const NOW = new Date("2026-11-10T09:30:05Z");
const folder = new URL("file:///app/src/migrations/");

function fakeMigrator(states: MigrationState[] = []): Migrator {
	return {
		migrate: vi.fn(async () => []),
		revert: vi.fn(async () => undefined),
		status: vi.fn(async () => states),
	};
}

function appWith(...targets: MigrationTarget[]) {
	const builder = new ServiceContainerBuilder();
	for (const target of targets) builder.registerSingleton(MigrationTargetToken, target);
	return { services: builder.build() };
}

function target(
	name: string,
	migrator: Migrator,
	diff: SchemaDiff = { up: [], down: [] },
	migrations: Migration[] = [],
): MigrationTarget {
	return {
		dataSource: name,
		source: { connection: connection(name), migrations, applicationName: "shop.api" },
		migrator,
		diff: async () => diff,
	};
}

describe("db.run", () => {
	let out: string[];
	const options = () => ({
		directory: folder,
		out: (line: string) => out.push(line),
		now: () => NOW,
	});

	beforeEach(() => {
		vol.reset();
		out = [];
	});

	it("migrates the only data source, passing on --to, --dry-run and the app's container", async () => {
		const migrator = fakeMigrator();
		const app = appWith(target("shop", migrator));

		await db.run(app, ["migrate", "--to", "20261110-093000-a", "--dry-run"], options());

		expect(migrator.migrate).toHaveBeenCalledWith(
			expect.objectContaining({ applicationName: "shop.api" }),
			expect.objectContaining({
				container: app.services,
				to: "20261110-093000-a",
				dryRun: true,
			}),
		);
		expect(out).toEqual(["Nothing to apply"]);
	});

	it("asks which data source when the app has several, and uses the one named", async () => {
		const orders = fakeMigrator();
		const app = appWith(target("shop", fakeMigrator()), target("orders", orders));

		await expect(db.run(app, ["migrate"], options())).rejects.toThrow(
			"The app has several data sources; name one with --data-source: shop, orders",
		);
		await db.run(app, ["migrate", "--data-source", "orders"], options());
		expect(orders.migrate).toHaveBeenCalledOnce();
	});

	it("says how to give a provider migrations when the app has none", async () => {
		await expect(db.run(appWith(), ["status"], options())).rejects.toThrow(
			"The app has no data sources with migrations",
		);
	});

	it("lists each migration's state", async () => {
		const at = new Date("2026-11-09T12:00:00Z");
		const app = appWith(
			target(
				"shop",
				fakeMigrator([
					{ id: "20261108-120000-gone", state: "unknown", appliedAt: at },
					{ id: "20261109-120000-create-orders", state: "applied", appliedAt: at },
					{ id: "20261110-093000-add-expiry", state: "pending" },
				]),
			),
		);

		await db.run(app, ["status"], options());

		expect(out).toEqual([
			"unknown  20261108-120000-gone  2026-11-09T12:00:00.000Z  (in the history, not in the code)",
			"applied  20261109-120000-create-orders  2026-11-09T12:00:00.000Z",
			"pending  20261110-093000-add-expiry",
		]);
	});

	it("generates a schema migration from the diff, and lists it in the folder's index", async () => {
		vol.fromJSON({ "/app/src/migrations/20261109-120000-create-orders.ts": "" });
		const app = appWith(
			target("shop", fakeMigrator(), {
				up: ['alter table "orders" add column "expires_at" timestamptz null'],
				down: ['alter table "orders" drop column "expires_at"'],
			}),
		);

		await db.run(app, ["generate", "add-expiry"], options());

		expect(out).toEqual(["Wrote /app/src/migrations/20261110-093005-add-expiry.ts"]);
		expect(vol.readFileSync("/app/src/migrations/20261110-093005-add-expiry.ts", "utf8"))
			.toBe(`import { defineMigration } from "@decohere/data";

export default defineMigration({
	id: "20261110-093005-add-expiry",
	async up({ sql }) {
		await sql("alter table \\"orders\\" add column \\"expires_at\\" timestamptz null");
	},
	async down({ sql }) {
		await sql("alter table \\"orders\\" drop column \\"expires_at\\"");
	},
});
`);
		expect(vol.readFileSync("/app/src/migrations/index.ts", "utf8"))
			.toBe(`// Written by the db commands: every migration in this folder, in id order.
import type { Migration } from "@decohere/data";
import m20261109_120000_create_orders from "./20261109-120000-create-orders.js";
import m20261110_093005_add_expiry from "./20261110-093005-add-expiry.js";

export const migrations: Migration[] = [m20261109_120000_create_orders, m20261110_093005_add_expiry];
`);
	});

	it("writes nothing when the tables already match the mappings", async () => {
		await db.run(appWith(target("shop", fakeMigrator())), ["generate", "nothing"], options());

		expect(out).toEqual(["The tables already match the mappings: nothing to write"]);
		expect(vol.existsSync("/app/src/migrations")).toBe(false);
	});

	it("refuses to generate while migrations are pending, since the diff would repeat them", async () => {
		const app = appWith(
			target("shop", fakeMigrator([{ id: "20261110-093000-add-expiry", state: "pending" }]), {
				up: ["alter table orders add column expires_at timestamptz"],
				down: [],
			}),
		);

		await expect(db.run(app, ["generate", "again"], options())).rejects.toThrow(
			"Apply the pending migrations first (db migrate), or the diff repeats them: 20261110-093000-add-expiry",
		);
	});

	it("writes a data migration that fails until it is written", async () => {
		await db.run(
			appWith(target("shop", fakeMigrator())),
			["new", "backfill-expiry", "--data"],
			options(),
		);

		const file = vol.readFileSync(
			"/app/src/migrations/20261110-093005-backfill-expiry.ts",
			"utf8",
		);
		expect(file).toContain("async up({ sql, batch, container })");
		expect(file).toContain(
			'throw new Error("Migration 20261110-093005-backfill-expiry is not written yet");',
		);
	});

	it("refuses a name that isn't lowercase words joined by dashes", async () => {
		await expect(
			db.run(appWith(target("shop", fakeMigrator())), ["new", "Add Expiry"], options()),
		).rejects.toThrow("A migration's name is lowercase words joined by dashes");
	});

	it("shows the usage for an unknown command", async () => {
		await expect(
			db.run(appWith(target("shop", fakeMigrator())), ["upgrade"], options()),
		).rejects.toThrow(/Unknown command "upgrade"\n\nUsage: db <command>/);
	});
});
