import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createConnection } from "node:net";
import { Pool } from "pg";
import { vi } from "vitest";

// vitest.setup.ts swaps node:fs for memfs; /.dockerenv is on the real disk.
const { existsSync } = await vi.importActual<typeof import("node:fs")>("node:fs");

/** A throwaway postgres:16 container for `*.docker.spec.ts` suites. */
export type PostgresContainer = {
	host: string;
	port: number;
	superuser: Pool;
	stop(): Promise<void>;
};

const SUPERUSER = "postgres";
const SUPER_PASSWORD = "postgres";

export type StartPostgresOptions = {
	/** Start the server with every connection trusted (pg_hba `trust`), like a local dev server. */
	trust?: boolean;
};

export async function startPostgres(
	options: StartPostgresOptions = {},
): Promise<PostgresContainer> {
	try {
		execFileSync("docker", ["info"], { stdio: "ignore" });
	} catch (err) {
		throw new Error("Docker is required for the *.docker.spec.ts suites", {
			cause: err,
		});
	}

	const name = `decohere-data-it-${randomBytes(4).toString("hex")}`;
	const auth = options.trust
		? ["-e", "POSTGRES_HOST_AUTH_METHOD=trust"]
		: ["-e", `POSTGRES_PASSWORD=${SUPER_PASSWORD}`];
	const containerId = execFileSync(
		"docker",
		["run", "-d", "--rm", "--name", name, ...auth, "-p", "127.0.0.1::5432", "postgres:16"],
		{ encoding: "utf8" },
	).trim();

	const { host, port } = address(containerId);
	await waitForTcp(host, port, 60_000);
	const superuser = await waitForSuperuser(host, port, options.trust === true);

	return {
		host,
		port,
		superuser,
		async stop() {
			await superuser.end();
			execFileSync("docker", ["stop", containerId], { stdio: "ignore" });
		},
	};
}

/**
 * Inside a dev container that shares the host's Docker daemon, a port published on the host's
 * 127.0.0.1 is out of reach, but the container's bridge address is not. Elsewhere (CI), use the
 * published port.
 */
function address(containerId: string): { host: string; port: number } {
	if (existsSync("/.dockerenv")) {
		const ip = execFileSync(
			"docker",
			[
				"inspect",
				"-f",
				"{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
				containerId,
			],
			{ encoding: "utf8" },
		).trim();
		if (ip.length === 0) throw new Error(`Container ${containerId} has no bridge address`);
		return { host: ip, port: 5432 };
	}
	const portMap = execFileSync("docker", ["port", containerId, "5432/tcp"], {
		encoding: "utf8",
	}).trim();
	// e.g. 127.0.0.1:32768
	const match = portMap.match(/:(\d+)\s*$/);
	if (!match?.[1]) {
		throw new Error(`Could not parse docker port mapping from: ${portMap}`);
	}
	return { host: "127.0.0.1", port: Number(match[1]) };
}

function waitForTcp(host: string, port: number, timeoutMs: number): Promise<void> {
	const start = Date.now();
	return new Promise((resolve, reject) => {
		const attempt = () => {
			const socket = createConnection({ host, port }, () => {
				socket.end();
				resolve();
			});
			socket.on("error", () => {
				socket.destroy();
				if (Date.now() - start > timeoutMs) {
					reject(new Error(`Timed out waiting for Postgres at ${host}:${port}`));
					return;
				}
				setTimeout(attempt, 200);
			});
		};
		attempt();
	});
}

/** The image restarts the server once after init, so the first logins can still fail. */
async function waitForSuperuser(host: string, port: number, trust: boolean): Promise<Pool> {
	const start = Date.now();
	for (;;) {
		const pool = new Pool({
			host,
			port,
			user: SUPERUSER,
			password: trust ? undefined : SUPER_PASSWORD,
			database: "postgres",
			connectionTimeoutMillis: 2000,
		});
		try {
			await pool.query("SELECT 1");
			return pool;
		} catch (err) {
			await pool.end();
			if (Date.now() - start > 60_000) {
				throw new Error("Timed out waiting for Postgres to accept superuser login", {
					cause: err,
				});
			}
			await new Promise((r) => setTimeout(r, 250));
		}
	}
}
