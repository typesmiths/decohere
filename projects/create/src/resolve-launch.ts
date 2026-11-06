import { basename, resolve } from "node:path";

/** `create` makes a new project. `project` works on one that already exists. */
export type LaunchKind = "create" | "project";

export type LaunchPlan = {
	targetDir: string;
	containerArgv: string[];
	projectName: string;
	kind: LaunchKind;
};

const HOST_FLAGS_WITH_VALUE = new Set(["--config-file", "--log-level"]);
const PRODUCT_COMMANDS = new Set(["create", "add", "auth0", "help"]);

/**
 * Map host / npm-create argv onto the product CLI (`create webapi` / `add api`).
 * `npm create @decohere webapi` already says “create”, so we prepend `create`
 * rather than making users type `create create webapi`. `webapi` is the only kind
 * of project, so a first word that isn't a command is the project's folder.
 */
export function toProductArgv(tokens: string[]): string[] {
	const [first] = tokens;
	if (first === "webapi" && tokens[1] === "add") {
		return ["add", "api", ...tokens.slice(2)];
	}
	if (first === "webapi") {
		return ["create", "webapi", ...tokens.slice(1)];
	}
	if (first != null && !first.startsWith("-") && !PRODUCT_COMMANDS.has(first)) {
		return ["create", "webapi", ...tokens];
	}
	return tokens;
}

export function containerArgvFromHost(argv: string[]): string[] {
	const user = argv[0]?.includes("node") || argv[0]?.endsWith("node") ? argv.slice(2) : argv;
	const stripped: string[] = [];
	for (let i = 0; i < user.length; i++) {
		const arg = user[i];
		if (arg != null && HOST_FLAGS_WITH_VALUE.has(arg)) {
			i++;
			continue;
		}
		if (arg != null) stripped.push(arg);
	}
	return toProductArgv(stripped);
}

/**
 * Host argv → directory to mount and argv for the in-image `decohere` entrypoint.
 * Positional `webapi my-app` / `create webapi my-app` wins over `-d` (npm treats `-d`
 * as its own loglevel).
 */
export function resolveLaunch(argv: string[], cwd = process.cwd()): LaunchPlan {
	if (
		argv.length === 1 &&
		(argv[0] === "--help" || argv[0] === "-h" || argv[0] === "--version")
	) {
		return {
			targetDir: cwd,
			containerArgv: argv,
			projectName: basename(cwd),
			kind: "create",
		};
	}
	let directoryFlag: string | undefined;
	const withoutD: string[] = [];
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "-d") {
			directoryFlag = argv[i + 1];
			i++;
			continue;
		}
		if (arg != null) withoutD.push(arg);
	}

	const product = toProductArgv(withoutD);
	const isAdd = product[0] === "add";
	let positional: string | undefined;
	let withoutPositional = product;
	if (
		!isAdd &&
		product[0] === "create" &&
		product[1] === "webapi" &&
		product[2] != null &&
		!product[2].startsWith("-")
	) {
		positional = product[2];
		withoutPositional = [product[0], product[1], ...product.slice(3)];
	}

	const targetDir = resolve(cwd, positional?.trim() || directoryFlag?.trim() || ".");
	return {
		targetDir,
		containerArgv: [...withoutPositional, "-d", "."],
		projectName: basename(targetDir),
		kind: product[0] === "auth0" || isAdd ? "project" : "create",
	};
}
