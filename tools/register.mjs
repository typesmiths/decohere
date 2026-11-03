// Runs this repo's own TypeScript (forge, flux, cli) straight from source.
//
// Flux can't load itself before it is compiled, so this is the minimal bootstrap:
// tsconfig `paths` (generated into tsconfig.paths.json by `forge paths`, read through the root
// tsconfig's `extends`) + `.js`→`.ts` resolution, and an SWC transform with forge's
// default options (decorators + metadata). Used by the `forge`/`flux` scripts and
// vitest.config.ts. Not shipped.
//
//   node --import ./tools/register.mjs projects/cli/src/forge.ts build
import { existsSync, readFileSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const require = createRequire(path.join(root, "package.json"));
const swc = require("@swc/core");
const ts = require("typescript");

const { config } = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
// Parsed, not read raw, so `extends` is followed.
const { options } = ts.parseJsonConfigFileContent(config, ts.sys, root);
const pathEntries = Object.entries(options.paths ?? {}).map(([key, [target]]) => [
	key,
	path.resolve(options.pathsBasePath ?? root, target),
]);
const aliases = new Map(
	pathEntries.filter(([key]) => !key.endsWith("/*")).map(([key, file]) => [key, file]),
);
// `@scope/pkg/*` → `<dir>/*`, longest prefix first.
const wildcards = pathEntries
	.filter(([key]) => key.endsWith("/*"))
	.map(([key, target]) => [key.slice(0, -1), target.replace(/[/\\]\*$/, "")])
	.sort(([a], [b]) => b.length - a.length);

/** The source file a `paths` key names: exact, else a wildcard's `<sub>.ts` or `<sub>/index.ts`. */
function aliasFor(specifier) {
	const exact = aliases.get(specifier);
	if (exact != null) return exact;
	for (const [prefix, dir] of wildcards) {
		if (!specifier.startsWith(prefix)) continue;
		const sub = path.join(dir, specifier.slice(prefix.length));
		return [`${sub}.ts`, path.join(sub, "index.ts")].find((file) => existsSync(file));
	}
	return undefined;
}

const swcOptions = {
	jsc: {
		parser: { syntax: "typescript", decorators: true },
		target: "esnext",
		transform: { decoratorMetadata: true },
		experimental: { keepImportAttributes: true },
	},
	module: { type: "es6" },
	sourceMaps: "inline",
};

const isOwnSource = (file) =>
	file.startsWith(root) && !file.includes(`${path.sep}node_modules${path.sep}`);

process.setSourceMapsEnabled(true);

registerHooks({
	resolve(specifier, context, nextResolve) {
		const alias = aliasFor(specifier);
		if (alias) return nextResolve(pathToFileURL(alias).href, context);

		if (
			specifier.startsWith(".") &&
			specifier.endsWith(".js") &&
			context.parentURL?.startsWith("file:")
		) {
			const candidate = fileURLToPath(new URL(specifier, context.parentURL)).replace(
				/\.js$/,
				".ts",
			);
			if (isOwnSource(candidate) && existsSync(candidate)) {
				return nextResolve(pathToFileURL(candidate).href, context);
			}
		}
		return nextResolve(specifier, context);
	},
	load(url, context, nextLoad) {
		if (url.startsWith("file:")) {
			const file = fileURLToPath(url.split("?")[0]);
			if (file.endsWith(".ts") && isOwnSource(file)) {
				const { code } = swc.transformSync(readFileSync(file, "utf8"), {
					...swcOptions,
					filename: file,
				});
				return { format: "module", source: code, shortCircuit: true };
			}
		}
		return nextLoad(url, context);
	},
});
