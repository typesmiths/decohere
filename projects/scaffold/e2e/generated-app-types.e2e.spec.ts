/**
 * Typechecks a generated app against the release build, seeing only what the app declares. This
 * catches on a PR, in seconds, what otherwise only shows up in `verify-release` on main. Locally,
 * run `pnpm forge build --configuration release` first.
 *
 * The packages are copied out of the repo. Mapping them to source would load the repo's own
 * `@types/node`, and a missing one would go unnoticed. Third-party packages an app only gets
 * indirectly aren't there, so their types are `any`: the real install on main covers those.
 */
import { spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const RELEASE = join(REPO, "dist/release/projects");
const TIMEOUT = 60_000;

type Manifest = {
	name?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
};

function readManifest(dir: string): Manifest {
	return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}

function findBuiltPackages(dir: string, found = new Map<string, string>()) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const path = join(dir, entry.name);
		const name = existsSync(join(path, "package.json")) ? readManifest(path).name : undefined;
		if (name) found.set(name, path);
		else findBuiltPackages(path, found);
	}
	return found;
}

function declaredBy(manifest: Manifest) {
	return Object.keys({ ...manifest.dependencies, ...manifest.devDependencies });
}

/** A node_modules holding what the app declares, and the @decohere packages those need. */
function install(app: string, built: Map<string, string>, leaveOut?: string) {
	const modules = join(app, "node_modules");
	rmSync(modules, { recursive: true, force: true });

	const copied = new Set<string>();
	const copyBuilt = (name: string) => {
		const from = built.get(name);
		if (from === undefined || copied.has(name)) return;
		copied.add(name);
		const to = join(modules, name);
		cpSync(from, to, {
			recursive: true,
			filter: (path) => !/\/tests(\/|$)/.test(path.slice(from.length)),
		});
		for (const dependency of declaredBy(readManifest(to))) copyBuilt(dependency);
	};

	for (const name of declaredBy(readManifest(app))) {
		if (name === leaveOut) continue;
		if (name.startsWith("@decohere/")) {
			copyBuilt(name);
			continue;
		}
		const from = join(REPO, "node_modules", name);
		// A tool the repo doesn't use, such as the generated app's formatter, has no types to offer.
		if (!existsSync(from)) continue;
		mkdirSync(dirname(join(modules, name)), { recursive: true });
		symlinkSync(from, join(modules, name));
	}
}

function forgeTypecheck(app: string) {
	return spawnSync(
		process.execPath,
		[
			"--import",
			join(REPO, "tools/register.mjs"),
			join(REPO, "projects/cli/src/forge.ts"),
			"typecheck",
		],
		{ cwd: app, encoding: "utf8", timeout: TIMEOUT },
	);
}

describe("a generated app's types", () => {
	let root: string;
	let app: string;
	let built: Map<string, string>;
	let main: string;
	let mainSource: string;

	beforeAll(() => {
		if (!existsSync(RELEASE)) {
			throw new Error(
				"No release build: run `pnpm forge build --configuration release` first.",
			);
		}
		built = findBuiltPackages(RELEASE);
		root = mkdtempSync(join(tmpdir(), "decohere-generated-types-"));
		app = join(root, "orders");
		const generated = spawnSync(
			process.execPath,
			[
				"--import",
				join(REPO, "tools/register.mjs"),
				join(REPO, "projects/scaffold/src/cli.ts"),
				"create",
				"webapi",
				"orders",
				"--database",
				"none",
				"--auth",
				"none",
				"--postman",
				"none",
				"--install",
				"no",
			],
			{ cwd: root, encoding: "utf8", input: "pnpm\n", timeout: TIMEOUT },
		);
		expect(generated.status, generated.stderr).toBe(0);
		main = join(app, "projects/api/src/main.ts");
		mainSource = readFileSync(main, "utf8");
	}, TIMEOUT);

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	it(
		"passes with what the app declares",
		() => {
			install(app, built);

			const result = forgeTypecheck(app);

			expect(result.status, `${result.stdout}${result.stderr}`).toBe(0);
		},
		TIMEOUT,
	);

	it(
		"fails when the app doesn't declare @types/node",
		() => {
			install(app, built, "@types/node");

			const result = forgeTypecheck(app);

			expect(result.status).not.toBe(0);
			expect(`${result.stdout}${result.stderr}`).toContain(
				"Cannot find type definition file for 'node'",
			);
		},
		TIMEOUT,
	);

	it(
		"fails when the app imports something a package doesn't export",
		() => {
			install(app, built);
			writeFileSync(
				main,
				`import { doesNotExist } from "@decohere/http";\nconsole.log(doesNotExist);\n${mainSource}`,
			);

			const result = forgeTypecheck(app);
			writeFileSync(main, mainSource);

			expect(result.status).not.toBe(0);
			expect(`${result.stdout}${result.stderr}`).toContain("doesNotExist");
		},
		TIMEOUT,
	);
});
