/**
 * E2e: uses Decohere the way a user does, from packages served by a real npm registry: the
 * launcher, the app it generates, and the install steps in the docs. CI runs this on `main` against
 * a temporary registry, so a version that fails never reaches npm.
 *
 * Requires DECOHERE_E2E_REGISTRY, with every package published there at DECOHERE_E2E_VERSION, and
 * the scaffolder image built under that version. Skipped without them.
 * The Dev Container checks also need DECOHERE_E2E_CONTAINER_REGISTRY, the same registry as seen
 * from inside a container.
 */
import { type ChildProcess, spawn } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const registry = process.env.DECOHERE_E2E_REGISTRY ?? "";
const version = process.env.DECOHERE_E2E_VERSION ?? "";
const containerRegistry = process.env.DECOHERE_E2E_CONTAINER_REGISTRY ?? "";

// Exact versions: a new release of a tool must not fail a publish without warning.
const PNPM_VERSIONS = ["10.34.6", "12.16.1"];
const DEVCONTAINER_CLI_VERSION = "0.90.0";
const FIVE_MINUTES = 300_000;

const SOURCE = `enum Level {
	Info = "info",
}
console.log(\`[\${Level.Info}] Hello, Ada!\`);
`;

describe.skipIf(!registry || !version)(
	"Decohere from a registry (real process)",
	() => {
		const root = mkdtempSync(join(tmpdir(), "decohere-real-install-"));
		const app = join(root, "orders");
		const userConfig = join(root, "user.npmrc");
		const env = {
			...process.env,
			NPM_CONFIG_REGISTRY: registry,
			NPM_CONFIG_USERCONFIG: userConfig,
		};

		// Not spawnSync: blocking the test worker this long makes Vitest's own calls time out.
		function run(
			command: string,
			args: string[],
			cwd: string,
			extraEnv: NodeJS.ProcessEnv = {},
		) {
			return new Promise<{ status: number | null; output: string }>((resolve, reject) => {
				const child = spawn(command, args, {
					cwd,
					env: { ...env, ...extraEnv },
					timeout: FIVE_MINUTES,
				});
				let output = "";
				child.stdout.on("data", (chunk) => {
					output += chunk;
				});
				child.stderr.on("data", (chunk) => {
					output += chunk;
				});
				child.on("error", reject);
				child.on("close", (status) => resolve({ status, output }));
			});
		}

		function expectOk(result: { status: number | null; output: string }) {
			expect(result.status, result.output).toBe(0);
		}

		/** Installs a pnpm of its own, so the one on this machine doesn't decide the result. */
		async function installPnpm(pnpmVersion: string): Promise<string> {
			const tool = join(root, `pnpm-${pnpmVersion}`);
			if (!existsSync(tool)) {
				mkdirSync(tool);
				expectOk(
					await run(
						"npm",
						["i", "--no-audit", "--no-fund", "--prefix", tool, `pnpm@${pnpmVersion}`],
						root,
					),
				);
			}
			return join(tool, "node_modules/.bin");
		}

		beforeAll(async () => {
			writeFileSync(userConfig, `registry=${registry}\n`);
		});

		afterAll(async () => {
			rmSync(root, { recursive: true, force: true });
		});

		async function generate(name: string, database: string) {
			expectOk(
				await run(
					"npm",
					[
						"create",
						`@decohere@${version}`,
						"--",
						"webapi",
						"-d",
						name,
						"--database",
						database,
						"--auth",
						"none",
						"--postman",
						"none",
						"-y",
					],
					root,
				),
			);
		}

		describe("the launcher", () => {
			it("generates an app", async () => {
				await generate("orders", "none");
				expect(existsSync(join(app, "projects/api/src/main.ts"))).toBe(true);
			});

			it("pins the app to the version it was launched at", async () => {
				const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
				const decohere = Object.entries({
					...pkg.dependencies,
					...pkg.devDependencies,
				}).filter(([name]) => name.startsWith("@decohere/"));

				expect(decohere.length).toBeGreaterThan(0);
				for (const [name, pinned] of decohere) {
					expect(pinned, name).toBe(version);
				}
				expect(readFileSync(join(app, ".devcontainer/Dockerfile"), "utf8")).toContain(
					`:${version}`,
				);
			});
		});

		describe.each(PNPM_VERSIONS)(
			"the generated app on pnpm %s",
			async (pnpmVersion) => {
				const dir = join(root, `app-${pnpmVersion}`);
				let path: string;
				let pnpm: string;

				beforeAll(async () => {
					const bin = await installPnpm(pnpmVersion);
					path = `${bin}:${process.env.PATH}`;
					pnpm = join(bin, "pnpm");
					cpSync(app, dir, { recursive: true });
					// Biome honours .gitignore through git, as in a real project.
					expectOk(await run("git", ["init", "-q"], dir));
				}, FIVE_MINUTES);

				it("installs with no error or notice about install scripts", async () => {
					const result = await run(pnpm, ["install"], dir, { PATH: path });

					expectOk(result);
					expect(result.output).not.toContain("Ignored build scripts");
				});

				it.each(["typecheck", "build", "test", "lint:check"])("passes %s", async (script) => {
					expectOk(await run(pnpm, ["run", script], dir, { PATH: path }));
				});

				it("answers on /health when started with dev", async () => {
					const port = 3100 + PNPM_VERSIONS.indexOf(pnpmVersion);
					const server: ChildProcess = spawn(pnpm, ["run", "dev"], {
						cwd: dir,
						env: { ...env, PATH: path, PORT: String(port) },
						detached: true,
						stdio: "ignore",
					});
					try {
						expect(await waitForHealth(port)).toBe(200);
					} finally {
						if (server.pid != null) process.kill(-server.pid, "SIGTERM");
					}
				});
			},
			FIVE_MINUTES,
		);

		// Inside a container, the registry is reached through the Docker host.
		describe.skipIf(!containerRegistry)(
			"the generated Dev Container",
			() => {
				const dir = join(root, "devcontainer-app");
				const devcontainer = (...args: string[]) =>
					run("npx", ["-y", `@devcontainers/cli@${DEVCONTAINER_CLI_VERSION}`, ...args], root);

				beforeAll(async () => {
					cpSync(app, dir, { recursive: true });
					writeFileSync(join(dir, ".npmrc"), `registry=${containerRegistry}\n`);
					expectOk(await run("git", ["init", "-q"], dir));
				});

				afterAll(async () => {
					const containers = await run(
						"docker",
						["ps", "-aq", "--filter", `label=devcontainer.local_folder=${dir}`],
						root,
					);
					for (const id of containers.output.split("\n").filter(Boolean)) {
						// It wrote files the runner's user can't delete.
						expectOk(
							await run(
								"docker",
								["exec", "-u", "root", id, "chmod", "-R", "a+rwX", "/orders"],
								root,
							),
						);
						expectOk(await run("docker", ["rm", "-f", id], root));
					}
				});

				it("builds, starts and installs the app", async () => {
					// Behave like a machine whose user ID matches the image's node user. On any other ID the tool
					// remaps that user, and the node_modules volume keeps the old owner.
					expectOk(await run("chmod", ["-R", "a+rwX", dir], root));
					expectOk(
						await devcontainer(
							"up",
							"--workspace-folder",
							dir,
							"--update-remote-user-uid-default",
							"off",
						),
					);
				});

				it.each(["typecheck", "build", "test", "lint:check"])(
					"passes %s inside it",
					async (script) => {
						expectOk(
							await devcontainer("exec", "--workspace-folder", dir, "pnpm", "run", script),
						);
					},
				);
			},
			FIVE_MINUTES,
		);

		// Adds its own Dockerfile layer, a Postgres service, and roles the app creates when it starts.
		describe.skipIf(!containerRegistry)(
			"the generated Dev Container with Postgres",
			() => {
				const dir = join(root, "shop");
				const compose = join(dir, ".devcontainer/docker-compose.yml");
				const devcontainer = (...args: string[]) =>
					run("npx", ["-y", `@devcontainers/cli@${DEVCONTAINER_CLI_VERSION}`, ...args], root);
				const inside = (script: string) =>
					devcontainer("exec", "--workspace-folder", dir, "bash", "-c", script);

				beforeAll(async () => {
					await generate("shop", "postgres/typeorm");
					writeFileSync(join(dir, ".npmrc"), `registry=${containerRegistry}\n`);
					expectOk(await run("git", ["init", "-q"], dir));
				}, FIVE_MINUTES);

				afterAll(async () => {
					const containers = await run(
						"docker",
						["ps", "-aq", "--filter", `label=devcontainer.local_folder=${dir}`],
						root,
					);
					for (const id of containers.output.split("\n").filter(Boolean)) {
						// It and Postgres wrote files the runner's user can't delete.
						expectOk(
							await run(
								"docker",
								["exec", "-u", "root", id, "chmod", "-R", "a+rwX", "/shop"],
								root,
							),
						);
					}
					// No need to wait for them to stop cleanly.
					expectOk(
						await run(
							"docker",
							["compose", "-f", compose, "down", "-v", "--timeout", "0"],
							root,
						),
					);
				}, FIVE_MINUTES);

				it("builds, starts and installs the app", async () => {
					// The same user ID workaround as the Dev Container without a database.
					expectOk(await run("chmod", ["-R", "a+rwX", dir], root));
					expectOk(
						await devcontainer(
							"up",
							"--workspace-folder",
							dir,
							"--update-remote-user-uid-default",
							"off",
						),
					);
				});

				it.each(["typecheck", "build", "test", "lint:check"])(
					"passes %s inside it",
					async (script) => {
						expectOk(
							await devcontainer("exec", "--workspace-folder", dir, "pnpm", "run", script),
						);
					},
				);

				it("starts against Postgres, and creates the role the app connects as", async () => {
					expectOk(
						await inside(`until pg_isready -h "$API_DB_HOST" -p "$API_DB_PORT"; do sleep 1; done
PORT=3200 pnpm run dev > /tmp/dev.log 2>&1 &
for _ in $(seq 1 60); do
  if curl -sf localhost:3200/health; then
    PGPASSWORD="$API_DB_PASSWORD" exec psql -h "$API_DB_HOST" -p "$API_DB_PORT" -U "$API_DB_USER" -d "$API_DB_NAME" -c "select 1"
  fi
  sleep 1
done
cat /tmp/dev.log
exit 1`),
					);
				});
			},
			FIVE_MINUTES,
		);

		// The steps in docs/getting-started.md.
		describe(
			"the CLI installed in an empty folder",
			() => {
				it("works with npm", async () => {
					const dir = join(root, "npm-steps");
					mkdirSync(dir);
					writeFileSync(join(dir, "app.ts"), SOURCE);

					expectOk(await run("npm", ["init", "-y"], dir));
					expectOk(await run("npm", ["pkg", "set", "type=module"], dir));
					expectOk(await run("npm", ["i", "-D", `@decohere/cli@${version}`], dir));

					const flux = await run("npx", ["flux", "run", "app.ts"], dir);
					expectOk(flux);
					expect(flux.output).toContain("[info] Hello, Ada!");
					expectOk(await run("npx", ["forge", "typecheck"], dir));
					expectOk(await run("npx", ["forge", "build"], dir));
				});

				it.each(PNPM_VERSIONS)("works with pnpm %s and its flag", async (pnpmVersion) => {
					const bin = await installPnpm(pnpmVersion);
					const pnpm = join(bin, "pnpm");
					const dir = join(root, `pnpm-steps-${pnpmVersion}`);
					mkdirSync(dir);
					writeFileSync(join(dir, "app.ts"), SOURCE);
					const extraEnv = { PATH: `${bin}:${process.env.PATH}` };

					expectOk(await run(pnpm, ["init"], dir, extraEnv));
					expectOk(
						await run(
							pnpm,
							["add", "-D", `@decohere/cli@${version}`, "--allow-build=@swc/core"],
							dir,
							extraEnv,
						),
					);

					const flux = await run(pnpm, ["exec", "flux", "run", "app.ts"], dir, extraEnv);
					expectOk(flux);
					expect(flux.output).toContain("[info] Hello, Ada!");
				});
			},
			FIVE_MINUTES,
		);
	},
	FIVE_MINUTES,
);

async function waitForHealth(port: number): Promise<number> {
	const deadline = Date.now() + 60_000;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`http://localhost:${port}/health`);
			if (response.ok) return response.status;
			lastError = new Error(`/health answered ${response.status}`);
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}
	throw new Error(`Nothing answered on port ${port}: ${String(lastError)}`);
}
