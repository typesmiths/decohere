import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { type LaunchPlan, resolveLaunch } from "./resolve-launch.js";
import { hasDecohereTools, isInContainer, OPEN_DEV_CONTAINER_MESSAGE } from "./tools.js";
import { CREATE_IMAGE_REPOSITORY, CREATE_VERSION } from "./version.js";

const BUILDER_IMAGE = `${CREATE_IMAGE_REPOSITORY}:${CREATE_VERSION}`;
const SCAFFOLD_PACKAGE = `@decohere/scaffold@${CREATE_VERSION}`;
const WORKSPACE = "/workspace";

/** Passed by name only, so the value is never on a command line. */
const ADMIN_PASSWORD_ENV = "DECOHERE_ADMIN_PASSWORD";

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 } as const;

/**
 * Where a command runs: right here if this container has Decohere's tools, otherwise in
 * the scaffolder image. Commands on an existing project need that project's Dev Container.
 */
export async function launch(argv: string[]): Promise<never> {
	const plan = resolveLaunch(argv);
	if (hasDecohereTools()) runHere(plan);
	if (plan.kind === "project") {
		console.error(OPEN_DEV_CONTAINER_MESSAGE);
		process.exit(1);
	}
	return runInBuilder(argv);
}

/** Help and version print and leave; nothing is written, so there's nothing to copy out. */
function writesProject({ containerArgv }: LaunchPlan): boolean {
	return !containerArgv.some((arg) => ["--help", "-h", "--version"].includes(arg));
}

/** A new project only goes into an empty folder, so a copy can never overwrite someone's files. */
function refuseFolderWithFiles(targetDir: string): void {
	if (!existsSync(targetDir)) return;
	const files = readdirSync(targetDir).filter((name) => name !== ".git");
	if (files.length === 0) return;
	console.error(
		`\n  ${targetDir} already has files in it.\n` +
			"  Choose a new folder. To change an existing project, run `pnpm decohere add` in its Dev Container.\n",
	);
	process.exit(1);
}

/** Meets Auth0's password rules whichever policy the tenant uses. */
function generateAdminPassword(): string {
	return `${randomBytes(18).toString("base64url")}aA1!`;
}

/** Store it in the Linux key store, if there is one. The value goes over stdin, never in argv. */
function saveToKeyStore(projectName: string, password: string): boolean {
	if (process.platform !== "linux") return false;
	const stored = spawnSync(
		"secret-tool",
		[
			"store",
			`--label=Decohere ${projectName} Auth0 admin`,
			...keyStoreAttributes(projectName),
		],
		{ input: password, stdio: ["pipe", "ignore", "ignore"] },
	);
	return stored.error == null && stored.status === 0;
}

function keyStoreAttributes(projectName: string): string[] {
	return ["service", "decohere", "project", projectName, "account", "auth0-admin"];
}

/**
 * After a successful run, save the generated password: in the OS key store where there is one,
 * otherwise in one private file outside the project. It's only for logging in, so nothing in
 * the app reads it. Nothing is saved if no admin was made.
 */
function saveAdminPassword(targetDir: string, projectName: string, password: string): void {
	const env = join(targetDir, ".env");
	const email = existsSync(env)
		? readFileSync(env, "utf8").match(/^AUTH0_ADMIN_USER_EMAIL=(.+)$/m)?.[1]
		: undefined;
	if (email == null) return;

	const folder = join(homedir(), ".config", "decohere");
	const file = join(folder, `${projectName}.env`);
	if (saveToKeyStore(projectName, password)) {
		// A file from an earlier run would hold a password that no longer works.
		rmSync(file, { force: true });
		console.log("\n  Auth0 admin password saved in your key store. To read it:");
		console.log(`\n    secret-tool lookup ${keyStoreAttributes(projectName).join(" ")}`);
		return;
	}

	mkdirSync(folder, { recursive: true, mode: 0o700 });
	writeFileSync(
		file,
		`AUTH0_ADMIN_USER_EMAIL=${email}\nAUTH0_ADMIN_USER_PASSWORD=${password}\n`,
		{ mode: 0o600 },
	);
	chmodSync(file, 0o600);
	console.log(
		`\n  No key store found, so the Auth0 admin password is in a private file: ${file}`,
	);
	if (isInContainer()) {
		console.log("  That's inside this container, so copy it if the container may be rebuilt.");
	}
}

function printNextSteps(targetDir: string): void {
	const open = isInContainer()
		? `    cd ${targetDir}\n    pnpm install\n    pnpm dev\n`
		: `    code ${targetDir}\n\n  Then reopen it in its Dev Container.\n`;
	console.log(`\n  Scaffold complete!\n\n  Open your project:\n\n${open}`);
}

/** Run the scaffolder in this container, without starting another one. */
function runHere(plan: LaunchPlan): never {
	const { targetDir, containerArgv, projectName, kind } = plan;
	const creating = kind === "create" && writesProject(plan);
	if (creating) {
		refuseFolderWithFiles(targetDir);
		mkdirSync(targetDir, { recursive: true });
	}

	const adminPassword = generateAdminPassword();
	const result = spawnSync("npx", ["--yes", SCAFFOLD_PACKAGE, ...containerArgv], {
		cwd: targetDir,
		stdio: "inherit",
		env: {
			...process.env,
			DECOHERE_BUILDER: "1",
			DECOHERE_PROJECT_NAME: projectName,
			[ADMIN_PASSWORD_ENV]: adminPassword,
		},
	});
	if (result.error != null) {
		console.error(`\n  Could not start the scaffolder: ${result.error.message}\n`);
		process.exit(1);
	}
	if (result.status === 0 && creating) {
		saveAdminPassword(targetDir, projectName, adminPassword);
		printNextSteps(targetDir);
	}
	process.exit(result.status ?? 1);
}

function assertDockerAvailable(): void {
	try {
		execFileSync("docker", ["info"], { stdio: "pipe" });
	} catch {
		console.error(
			isInContainer()
				? "\n  Docker is required to scaffold a Decohere project, and this container can't reach it.\n" +
						"  Run this on your own machine, or give this container access to Docker.\n"
				: "\n  Docker is required to scaffold a Decohere project.\n" +
						"  Install Docker Desktop: https://www.docker.com/products/docker-desktop\n",
		);
		process.exit(1);
	}
}

/** The container holds generated files and any Auth0 login until this runs. */
function removeContainer(name: string): void {
	const removed = spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
	if (removed.status !== 0) {
		console.error(
			`\n  Could not remove container ${name}. Remove it with: docker rm -f ${name}\n`,
		);
	}
}

/**
 * Copy the finished project out of the container. It lands in a temporary folder first, so a
 * copy that fails partway leaves the target as it was.
 */
function copyProjectOut(name: string, targetDir: string): void {
	const createdTarget = !existsSync(targetDir);
	mkdirSync(targetDir, { recursive: true });
	const temp = mkdtempSync(join(targetDir, ".decohere-create-"));
	try {
		const copy = spawnSync("docker", ["cp", `${name}:${WORKSPACE}/.`, temp], {
			stdio: ["ignore", "ignore", "inherit"],
		});
		if (copy.status !== 0) {
			throw new Error(`docker cp failed with exit code ${copy.status}`);
		}
		for (const entry of readdirSync(temp)) {
			renameSync(join(temp, entry), join(targetDir, entry));
		}
		rmSync(temp, { recursive: true, force: true });
	} catch (reason) {
		rmSync(createdTarget ? targetDir : temp, { recursive: true, force: true });
		throw reason;
	}
}

function attach(name: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const child = spawn("docker", ["start", "--attach", "--interactive", name], {
			stdio: "inherit",
		});
		child.on("error", reject);
		child.on("close", (code) => resolve(code ?? 1));
	});
}

/**
 * Run the scaffolder image with nothing shared from this machine, then copy the project out.
 * Docker finds shared folders on the machine running Docker, which may not be this one, so
 * this works the same from a host, a container, or against a remote Docker.
 */
export async function runInBuilder(argv: string[]): Promise<never> {
	const plan = resolveLaunch(argv);
	const { targetDir, containerArgv, projectName } = plan;
	const copyOut = writesProject(plan);
	if (copyOut) refuseFolderWithFiles(targetDir);
	assertDockerAvailable();

	const name = `decohere-create-${randomBytes(6).toString("hex")}`;
	const adminPassword = generateAdminPassword();
	const ttyFlags = process.stdin.isTTY ? ["--interactive", "--tty"] : ["--interactive"];
	const created = spawnSync(
		"docker",
		[
			"create",
			"--name",
			name,
			...ttyFlags,
			"--env",
			"DECOHERE_BUILDER=1",
			"--env",
			`DECOHERE_PROJECT_NAME=${projectName}`,
			"--env",
			ADMIN_PASSWORD_ENV,
			"--workdir",
			WORKSPACE,
			BUILDER_IMAGE,
			...containerArgv,
		],
		{
			stdio: ["ignore", "ignore", "inherit"],
			env: { ...process.env, [ADMIN_PASSWORD_ENV]: adminPassword },
		},
	);
	if (created.status !== 0) process.exit(created.status ?? 1);

	for (const [signal, code] of Object.entries(SIGNAL_EXIT_CODES)) {
		process.once(signal, () => {
			removeContainer(name);
			process.exit(code);
		});
	}

	console.log("  Running scaffolding in a sandboxed container...\n");

	let exitCode = 1;
	try {
		exitCode = await attach(name);
		if (exitCode === 0 && copyOut) {
			copyProjectOut(name, targetDir);
			saveAdminPassword(targetDir, projectName, adminPassword);
			printNextSteps(targetDir);
		}
	} catch (reason) {
		exitCode = 1;
		console.error(
			`\n  Could not finish the scaffold: ${reason instanceof Error ? reason.message : String(reason)}\n`,
		);
	} finally {
		removeContainer(name);
	}
	process.exit(exitCode);
}
