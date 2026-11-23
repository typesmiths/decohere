/**
 * Measures how far Decohere's code is from ADR 0027: per package, how many times each rule is
 * broken, with where. Reads each package's `src/` with the TypeScript compiler's parser (no
 * type-check), and its spec files wherever they are.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import ts from "typescript";
import { FileRoles } from "./file-roles.registry.mjs";

/** The rules counted, and what each count means. */
export const RULES = {
	looseFunctions:
		"exported loose functions (not a plugin factory, decorator, define… helper or is/has predicate)",
	namespaceObjects: "namespace objects (export const x = { fn, … })",
	severalClasses: "files with several classes",
	bannedNames: ".types.ts, .store.ts and utils/helpers/common/shared/misc files",
	noRole: "files with no role suffix",
	envReads: "process.env reads outside config and the package's bins",
	specsAway: "spec files not beside their code (outside src/)",
};

const BANNED = /(^|[.-])(utils?|helpers?|common|shared|misc)([.-]|$)|\.(types|store)$/;
const SPEC = /\.(spec|test)\.(ts|mts|mjs|js)$/;

export class CodeDesign {
	/** @param {string} root the workspace root */
	constructor(root) {
		this.root = root;
		/** @private */
		this.roles = new FileRoles(root);
	}

	/**
	 * @returns {Record<string, Record<string, { count: number, where: string[] }>>} per package, per rule
	 */
	measure() {
		/** @type {Record<string, Record<string, { count: number, where: string[] }>>} */
		const result = {};
		for (const { name, dir, bins } of this.packages()) {
			const tally = Object.fromEntries(
				Object.keys(RULES).map((rule) => [
					rule,
					{ count: 0, where: /** @type {string[]} */ ([]) },
				]),
			);
			const add = (rule, where) => {
				tally[rule].count++;
				tally[rule].where.push(where);
			};
			for (const file of this.files(dir)) {
				const rel = relative(this.root, file);
				if (SPEC.test(file)) {
					if (!relative(dir, file).startsWith("src/")) {
						add("specsAway", rel);
					}
					continue;
				}
				if (
					!relative(dir, file).startsWith("src/") ||
					!/\.(ts|mts)$/.test(file) ||
					file.endsWith(".d.ts")
				) {
					continue;
				}
				this.measureFile(file, rel, name, bins, add);
			}
			result[name] = Object.fromEntries(Object.entries(tally).filter(([, t]) => t.count > 0));
		}
		return result;
	}

	/** @private */
	measureFile(file, rel, name, bins, add) {
		const text = readFileSync(file, "utf8");
		const base = basename(file).replace(/\.(ts|mts)$/, "");
		if (BANNED.test(base)) {
			add("bannedNames", rel);
		}
		const role = base.split(".");
		if (base !== "index" && (role.length < 2 || !this.roles.has(role.at(-1)))) {
			add("noRole", rel);
		}
		const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
		const isPluginFile = role.at(-1) === "plugin";
		if (name !== "config" && !bins.has(relative(this.root, file))) {
			for (let i = countEnvReads(source); i > 0; i--) {
				add("envReads", rel);
			}
		}
		let classes = 0;
		for (const statement of source.statements) {
			if (ts.isClassDeclaration(statement)) {
				classes++;
			}
			if (!isExported(statement)) {
				continue;
			}
			if (ts.isFunctionDeclaration(statement)) {
				const fn = statement.name?.text ?? "default";
				// A .plugin.ts file holds a plugin factory, whatever writer or module it returns.
				if (!isPluginFile && !isAllowedFunction(fn, statement)) {
					add("looseFunctions", `${rel}: ${fn}`);
				}
			}
			if (ts.isVariableStatement(statement)) {
				for (const declaration of statement.declarationList.declarations) {
					const init = declaration.initializer;
					const variable = declaration.name.getText();
					if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
						if (!isAllowedFunction(variable, init)) {
							add("looseFunctions", `${rel}: ${variable}`);
						}
					} else if (init && ts.isObjectLiteralExpression(init) && holdsFunctions(init)) {
						add("namespaceObjects", `${rel}: ${variable}`);
					}
				}
			}
		}
		if (classes > 1) {
			add("severalClasses", rel);
		}
	}

	/** @private Every package under projects/, with the source files its bins start from. */
	packages() {
		/** @type {{ name: string, dir: string, bins: Set<string> }[]} */
		const found = [];
		const visit = (dir) => {
			for (const entry of readdirSync(dir)) {
				if (entry === "node_modules" || entry === "__fixtures__" || entry === "dist") {
					continue;
				}
				const path = join(dir, entry);
				if (!statSync(path).isDirectory()) {
					continue;
				}
				if (!existsSync(join(path, "package.json"))) {
					visit(path);
					continue;
				}
				const manifest = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
				const bin =
					typeof manifest.bin === "string"
						? [manifest.bin]
						: Object.values(manifest.bin ?? {});
				const bins = new Set(
					bin.map((target) =>
						relative(
							this.root,
							join(
								path,
								String(target)
									.replace(/^\.\/(es6|dist\/[^/]+)\//, "")
									.replace(/\.js$/, ".ts"),
							),
						),
					),
				);
				found.push({
					name: String(manifest.name).replace(/^@decohere\//, ""),
					dir: path,
					bins,
				});
			}
		};
		visit(join(this.root, "projects"));
		return found.sort((a, b) => a.name.localeCompare(b.name));
	}

	/** @private */
	files(dir) {
		/** @type {string[]} */
		const out = [];
		const visit = (current) => {
			for (const entry of readdirSync(current)) {
				if (["node_modules", "dist", "e2e", "__fixtures__"].includes(entry)) {
					continue;
				}
				const path = join(current, entry);
				if (statSync(path).isDirectory()) {
					// A nested package is measured on its own.
					if (path !== dir && existsSync(join(path, "package.json"))) {
						continue;
					}
					visit(path);
				} else {
					out.push(path);
				}
			}
		};
		visit(dir);
		return out;
	}
}

/** @param {ts.Statement} statement */
/**
 * `process.env` in code: a property read, so the words in a string (a template for generated
 * code) or a comment don't count.
 *
 * @param {ts.Node} node
 * @returns {number}
 */
function countEnvReads(node) {
	const here =
		ts.isPropertyAccessExpression(node) &&
		node.name.text === "env" &&
		ts.isIdentifier(node.expression) &&
		node.expression.text === "process"
			? 1
			: 0;
	let below = 0;
	node.forEachChild((child) => {
		below += countEnvReads(child);
	});
	return here + below;
}

function isExported(statement) {
	return (
		ts.canHaveModifiers(statement) &&
		(ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
	);
}

/**
 * Plugin factories, decorators, define… helpers and is/has predicates are the loose functions
 * ADR 0027 keeps.
 *
 * @param {string} name
 * @param {ts.FunctionLikeDeclaration} fn
 */
function isAllowedFunction(name, fn) {
	if (/^(is|has)[A-Z]/.test(name) || /^define[A-Z]/.test(name)) {
		return true;
	}
	const returns = fn.type?.getText() ?? "";
	if (/Plugin\b|Decorator\b/.test(returns)) {
		return true;
	}
	const body = fn.body?.getText() ?? "";
	// A factory returning `(builder) => …`, or a decorator returning `(target…) => …`.
	return /return \(?(builder|target|_target)\b/.test(body);
}

/** @param {ts.ObjectLiteralExpression} object */
function holdsFunctions(object) {
	return object.properties.some(
		(p) =>
			ts.isShorthandPropertyAssignment(p) ||
			ts.isMethodDeclaration(p) ||
			(ts.isPropertyAssignment(p) &&
				(ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))),
	);
}
