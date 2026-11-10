import type { WorkspaceChanges } from "../templates/workspace-changes.js";

/**
 * Changes to an app's `src/app.ts`, the code that composes it. The file is the user's, so an edit
 * only touches the shape the recipe generated, and is skipped when its code is already there.
 */
export type SourceEdit = {
	/** Whole import lines the code needs. */
	imports: readonly string[];
	/** True when the code is already there. */
	isDone(source: string): boolean;
	/** The source with the code added, or `undefined` if it hasn't the shape this edit expects. */
	apply(source: string): string | undefined;
	/** What to add by hand when it can't. */
	byHand: readonly string[];
};

const IMPORT_STATEMENT = /^import\b[^;]*;[ \t]*$/gm;

function addImports(source: string, imports: readonly string[]): string {
	const missing = [...new Set(imports)].filter((line) => !source.includes(line));
	if (missing.length === 0) return source;
	const lastImport = [...source.matchAll(IMPORT_STATEMENT)].at(-1);
	if (lastImport == null) return `${missing.join("\n")}\n${source}`;
	const end = lastImport.index + lastImport[0].length;
	return `${source.slice(0, end)}\n${missing.join("\n")}${source.slice(end)}`;
}

/** `text`'s lines at the indent of the line `anchor` matches, plus their own tabs. */
function indented(line: string, text: string): string {
	const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
	return text
		.split("\n")
		.map((part) => `${indent}${part}`)
		.join("\n");
}

function lineAt(source: string, anchor: RegExp): { start: number; end: number } | undefined {
	const match = new RegExp(
		anchor.source,
		anchor.flags.includes("m") ? anchor.flags : `${anchor.flags}m`,
	).exec(source);
	if (match == null) return undefined;
	const start = source.lastIndexOf("\n", match.index) + 1;
	const newline = source.indexOf("\n", match.index);
	return { start, end: newline === -1 ? source.length : newline };
}

/** Inserts `text` after the line that `anchor` matches, at that line's indent. */
function insertAfter(anchor: RegExp, text: string) {
	return (source: string): string | undefined => {
		const line = lineAt(source, anchor);
		if (line == null) return undefined;
		const added = indented(source.slice(line.start, line.end), text);
		return `${source.slice(0, line.end)}\n${added}${source.slice(line.end)}`;
	};
}

/** Inserts `text` before the line that `anchor` matches, at that line's indent. */
function insertBefore(anchor: RegExp, text: string) {
	return (source: string): string | undefined => {
		const line = lineAt(source, anchor);
		if (line == null) return undefined;
		const added = indented(source.slice(line.start, line.end), text);
		return `${source.slice(0, line.start)}${added}\n${source.slice(line.start)}`;
	};
}

/** Replaces the first match of `find`. */
function replace(find: RegExp, replacement: string) {
	return (source: string): string | undefined =>
		find.test(source) ? source.replace(find, replacement) : undefined;
}

/** Where an app is composed: `src/app.ts`, or `src/main.ts` in an app from before app.ts. */
function pathOf(changes: WorkspaceChanges, app: string): string {
	const appTs = `projects/${app}/src/app.ts`;
	return changes.read(appTs) != null ? appTs : `projects/${app}/src/main.ts`;
}

function read(changes: WorkspaceChanges, app: string): string {
	return changes.read(pathOf(changes, app)) ?? "";
}

/**
 * Makes each edit that isn't done yet. If one can't be made, the file stays as it is and the user
 * is told every line still missing, so it is never left half changed.
 */
function edit(changes: WorkspaceChanges, app: string, edits: readonly SourceEdit[]): void {
	const path = pathOf(changes, app);
	const source = changes.read(path);
	const pending = edits.filter((item) => source == null || !item.isDone(source));
	if (pending.length === 0 || source == null) {
		if (pending.length > 0) changes.tellByHand(path, byHandLines(pending));
		return;
	}
	let result = source;
	for (const item of pending) {
		const next = item.apply(result);
		if (next == null) {
			changes.tellByHand(path, byHandLines(pending));
			return;
		}
		result = next;
	}
	changes.write(
		path,
		addImports(
			result,
			pending.flatMap((item) => item.imports),
		),
	);
}

function byHandLines(edits: readonly SourceEdit[]): string[] {
	return [...edits.flatMap((item) => item.imports), ...edits.flatMap((item) => item.byHand)];
}

export const appSource = { edit, insertAfter, insertBefore, read, replace };
