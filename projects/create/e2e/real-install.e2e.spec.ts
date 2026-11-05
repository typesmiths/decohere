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
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
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

		function run(
			command: string,
			args: string[],
			cwd: string,
			extraEnv: NodeJS.ProcessEnv = {},
		) {
			const result = spawnSync(command, args, {
				cwd,
				env: { ...env, ...extraEnv },
				encoding: "utf8",
				timeout: FIVE_MINUTES,
			});
			return { status: result.status, output: `${result.stdout}${result.stderr}` };
		}

		function expectOk(result: { status: number | null; output: string }) {
			expect(result.status, result.output).toBe(0);
		}

		/** Installs a pnpm of its own, so the one on this machine doesn't decide the result. */
		function installPnpm(pnpmVersion: string): string {
			const tool = join(root, `pnpm-${pnpmVersion}`);
			if (!existsSync(tool)) {
				mkdirSync(tool);
				expectOk(
					run(
						"npm",
						["i", "--no-audit", "--no-fund", "--prefix", tool, `pnpm@${pnpmVersion}`],
						root,
					),
				);
			}
			return join(tool, "node_modules/.bin");
		}

		beforeAll(() => {
			writeFileSync(userConfig, `registry=${registry}\n`);
		});

		afterAll(() => {
			rmSync(root, { recursive: true, force: true });
		});

		describe("the launcher", () => {
			it("generates an app", () => {
				expectOk(
					run(
						"npm",
						[
							"create",
							`@decohere@${version}`,
							"--",
							"webapi",
							"-d",
							"orders",
							"--database",
							"none",
							"--auth",
							"none",
							"--postman",
							"none",
							"-y",
						],
						root,
					),
				);
				expect(existsSync(join(app, "projects/api/src/main.ts"))).toBe(true);
			});

			it("pins the app to the version it was launched at", () => {
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
			(pnpmVersion) => {
				const dir = join(root, `app-${pnpmVersion}`);
				let path: string;
				let pnpm: string;

				beforeAll(() => {
					const bin = installPnpm(pnpmVersion);
					path = `${bin}:${process.env.PATH}`;
					pnpm = join(bin, "pnpm");
					cpSync(app, dir, { recursive: true });
					// Biome honours .gitignore through git, as in a real project.
					expectOk(run("git", ["init", "-q"], dir));
				}, FIVE_MINUTES);

				it("installs with no error or notice about install scripts", () => {
					const result = run(pnpm, ["install"], dir, { PATH: path });

					expectOk(result);
					expect(result.output).not.toContain("Ignored build scripts");
				});

				it.each(["typecheck", "build", "test", "lint:check"])("passes %s", (script) => {
					expectOk(run(pnpm, ["run", script], dir, { PATH: path }));
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

				beforeAll(() => {
					cpSync(app, dir, { recursive: true });
					writeFileSync(join(dir, ".npmrc"), `registry=${containerRegistry}\n`);
					expectOk(run("git", ["init", "-q"], dir));
				});

				afterAll(() => {
					const containers = run(
						"docker",
						["ps", "-aq", "--filter", `label=devcontainer.local_folder=${dir}`],
						root,
					);
					for (const id of containers.output.split("\n").filter(Boolean)) {
						// It wrote files the runner's user can't delete.
						expectOk(run("docker", ["exec", id, "chmod", "-R", "a+rwX", "/orders"], root));
						expectOk(run("docker", ["rm", "-f", id], root));
					}
				});

				it("builds, starts and installs the app", () => {
					// Behave like a machine whose user ID matches the image's node user. On any other ID the tool
					// remaps that user, and the node_modules volume keeps the old owner.
					expectOk(run("chmod", ["-R", "a+rwX", dir], root));
					expectOk(
						devcontainer(
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
					(script) => {
						expectOk(devcontainer("exec", "--workspace-folder", dir, "pnpm", "run", script));
					},
				);
			},
			FIVE_MINUTES,
		);

		// The steps in docs/getting-started.md.
		describe(
			"the CLI installed in an empty folder",
			() => {
				it("works with npm", () => {
					const dir = join(root, "npm-steps");
					mkdirSync(dir);
					writeFileSync(join(dir, "app.ts"), SOURCE);

					expectOk(run("npm", ["init", "-y"], dir));
					expectOk(run("npm", ["pkg", "set", "type=module"], dir));
					expectOk(run("npm", ["i", "-D", `@decohere/cli@${version}`], dir));

					const flux = run("npx", ["flux", "run", "app.ts"], dir);
					expectOk(flux);
					expect(flux.output).toContain("[info] Hello, Ada!");
					expectOk(run("npx", ["forge", "typecheck"], dir));
					expectOk(run("npx", ["forge", "build"], dir));
				});

				it.each(PNPM_VERSIONS)("works with pnpm %s and its flag", (pnpmVersion) => {
					const bin = installPnpm(pnpmVersion);
					const pnpm = join(bin, "pnpm");
					const dir = join(root, `pnpm-steps-${pnpmVersion}`);
					mkdirSync(dir);
					writeFileSync(join(dir, "app.ts"), SOURCE);
					const extraEnv = { PATH: `${bin}:${process.env.PATH}` };

					expectOk(run(pnpm, ["init"], dir, extraEnv));
					expectOk(
						run(
							pnpm,
							["add", "-D", `@decohere/cli@${version}`, "--allow-build=@swc/core"],
							dir,
							extraEnv,
						),
					);

					const flux = run(pnpm, ["exec", "flux", "run", "app.ts"], dir, extraEnv);
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
