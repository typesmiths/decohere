import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { Npm } from "../npm/npm.js";
import { Pnpm } from "../pnpm/pnpm.js";
import { Yarn } from "../yarn/yarn.js";
import type { PackageManager } from "./package-manager.js";

const LOCKFILES: Array<[string, () => PackageManager]> = [
	["pnpm-lock.yaml", () => new Pnpm()],
	["yarn.lock", () => new Yarn()],
	["package-lock.json", () => new Npm()],
];

function fromLockfile(cwd: string): PackageManager | undefined {
	for (const [file, factory] of LOCKFILES) {
		if (existsSync(join(cwd, file))) return factory();
	}
	return undefined;
}

function fromUserAgent(): PackageManager | undefined {
	const agent = process.env.npm_config_user_agent ?? "";
	if (agent.startsWith("pnpm")) return new Pnpm();
	if (agent.startsWith("yarn")) return new Yarn();
	if (agent.startsWith("npm")) return new Npm();
	return undefined;
}

export function detectPackageManager(cwd: string): PackageManager | undefined {
	return fromLockfile(cwd) ?? fromUserAgent();
}

export function packageManagerFromString(name: string): PackageManager {
	if (name === "yarn") return new Yarn();
	if (name === "npm") return new Npm();
	return new Pnpm();
}

export async function promptForPackageManager(): Promise<PackageManager> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await rl.question("Package manager? [pnpm/yarn/npm] (default: pnpm): ");
	rl.close();
	return packageManagerFromString(answer.trim().toLowerCase());
}
