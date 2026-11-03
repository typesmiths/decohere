import type { ConnectionInfo } from "@decohere/data";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { PoolMock, connectMock } = vi.hoisted(() => {
	const connectMock = vi.fn();
	const PoolMock = vi.fn(function Pool(
		this: { connect: typeof connectMock },
		_options: unknown,
	) {
		this.connect = connectMock;
		return this;
	});
	return { PoolMock, connectMock };
});

vi.mock("pg", () => ({ Pool: PoolMock }));

import { PostgresServerManager } from "../src/server-manager.js";

function adminInfo(overrides: Partial<ConnectionInfo> = {}): ConnectionInfo {
	return {
		name: "api",
		provider: "postgres",
		host: "postgres",
		port: 5432,
		database: "crypto_api_dev",
		synchronize: true,
		seed: true,
		username: "crypto_api_app",
		password: "app-secret",
		bootstrap: true,
		adminUser: "decohere_bootstrap",
		adminPassword: "bootstrap-secret",
		...overrides,
	};
}

describe("PostgresServerManager.connect", () => {
	beforeEach(() => {
		PoolMock.mockClear();
		connectMock.mockReset();
		connectMock.mockResolvedValue({ release: vi.fn() });
	});

	it("connects the bootstrap role to the postgres maintenance database", async () => {
		const manager = new PostgresServerManager("crypto", adminInfo());
		await manager.connect();

		expect(PoolMock).toHaveBeenCalledWith(
			expect.objectContaining({
				user: "decohere_bootstrap",
				password: "bootstrap-secret",
				host: "postgres",
				port: 5432,
				database: "postgres",
				application_name: "crypto",
			}),
		);
		expect(PoolMock.mock.calls[0]?.[0]).not.toEqual(
			expect.objectContaining({ database: "decohere_bootstrap" }),
		);
	});

	it("wraps connection failures with host/port context", async () => {
		connectMock.mockRejectedValue(new Error('database "decohere_bootstrap" does not exist'));
		const manager = new PostgresServerManager("crypto", adminInfo());

		await expect(manager.connect()).rejects.toThrow(
			/Cannot connect to PostgreSQL at postgres:5432/,
		);
	});
});
