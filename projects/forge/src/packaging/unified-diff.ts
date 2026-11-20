/**
 * Reads and applies unified diffs, the format `pnpm patch` and `git diff` write. Only what
 * those produce is supported: text hunks, new and deleted files. A rename, a copy or a binary
 * patch is refused rather than half applied.
 *
 * Applying is pure: it takes each file's current content and returns the new one, so a caller
 * can check that every hunk of every file applies before it writes anything.
 */

export class UnifiedDiffError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = UnifiedDiffError.name;
	}
}

export type Hunk = {
	/** The `@@ -a,b +c,d @@` line, for messages. */
	header: string;
	/** 1-based line in the old file where the hunk starts (0 for an empty old side). */
	oldStart: number;
	oldLines: string[];
	newLines: string[];
	/** The old side's last line has no newline after it (`\ No newline at end of file`). */
	oldEndsWithoutNewline: boolean;
	newEndsWithoutNewline: boolean;
};

export type FileDiff = {
	/** Path before the change, with the `a/` prefix stripped; `null` for a new file. */
	oldPath: string | null;
	/** Path after the change, with the `b/` prefix stripped; `null` for a deleted file. */
	newPath: string | null;
	hunks: Hunk[];
};

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Splits a patch into its files and hunks. */
function parse(text: string): FileDiff[] {
	const lines = text.split("\n");
	const files: FileDiff[] = [];
	let current: (FileDiff & { gitPaths?: [string, string] }) | undefined;
	let newFile = false;
	let deletedFile = false;

	const finish = () => {
		if (current == null) return;
		if (current.hunks.length === 0 && current.gitPaths != null && (newFile || deletedFile)) {
			// An empty file added or removed: git writes no ---/+++ lines and no hunks.
			const [oldPath, newPath] = current.gitPaths;
			current.oldPath = newFile ? null : oldPath;
			current.newPath = deletedFile ? null : newPath;
		}
		if (current.oldPath == null && current.newPath == null) {
			throw new UnifiedDiffError("A file in the patch names no path.");
		}
		files.push({ oldPath: current.oldPath, newPath: current.newPath, hunks: current.hunks });
		current = undefined;
		newFile = false;
		deletedFile = false;
	};

	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (line.startsWith("diff --git ")) {
			finish();
			const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
			current = {
				oldPath: null,
				newPath: null,
				hunks: [],
				gitPaths: match == null ? undefined : [match[1], match[2]],
			};
			i++;
			continue;
		}
		if (/^(rename|copy) (from|to) /.test(line)) {
			throw new UnifiedDiffError(`Renamed or copied files are not supported: "${line}".`);
		}
		if (line.startsWith("GIT binary patch") || /^Binary files .* differ$/.test(line)) {
			throw new UnifiedDiffError("Binary patches are not supported.");
		}
		if (line.startsWith("new file mode")) {
			newFile = true;
			i++;
			continue;
		}
		if (line.startsWith("deleted file mode")) {
			deletedFile = true;
			i++;
			continue;
		}
		if (line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) {
			if (current == null || current.hunks.length > 0) {
				finish();
				current = { oldPath: null, newPath: null, hunks: [] };
			}
			current.oldPath = stripPrefix(line.slice(4));
			current.newPath = stripPrefix(lines[i + 1].slice(4));
			i += 2;
			continue;
		}
		if (line.startsWith("@@")) {
			if (current == null) {
				throw new UnifiedDiffError(`Hunk "${line}" comes before any file header.`);
			}
			const [hunk, next] = parseHunk(lines, i);
			current.hunks.push(hunk);
			i = next;
			continue;
		}
		i++; // index lines, mode lines, and anything else git writes between files
	}
	finish();
	return files;
}

function parseHunk(lines: readonly string[], start: number): [Hunk, number] {
	const header = lines[start];
	const match = HUNK_HEADER.exec(header);
	if (match == null) {
		throw new UnifiedDiffError(`Can't read hunk header "${header}".`);
	}
	const oldCount = match[2] == null ? 1 : Number(match[2]);
	const newCount = match[4] == null ? 1 : Number(match[4]);
	const hunk: Hunk = {
		header: match[0],
		oldStart: Number(match[1]),
		oldLines: [],
		newLines: [],
		oldEndsWithoutNewline: false,
		newEndsWithoutNewline: false,
	};

	let i = start + 1;
	let last: " " | "-" | "+" | undefined;
	while (i < lines.length) {
		const line = lines[i];
		if (line.startsWith("\\")) {
			if (last === " " || last === "-") hunk.oldEndsWithoutNewline = true;
			if (last === " " || last === "+") hunk.newEndsWithoutNewline = true;
			i++;
			continue;
		}
		if (hunk.oldLines.length >= oldCount && hunk.newLines.length >= newCount) {
			break;
		}
		// Some editors strip the space that marks an empty context line.
		const kind = line === "" ? " " : line[0];
		const text = line.slice(1);
		if (kind === " ") {
			hunk.oldLines.push(text);
			hunk.newLines.push(text);
		} else if (kind === "-") {
			hunk.oldLines.push(text);
		} else if (kind === "+") {
			hunk.newLines.push(text);
		} else {
			break;
		}
		last = kind;
		i++;
	}
	if (hunk.oldLines.length !== oldCount || hunk.newLines.length !== newCount) {
		throw new UnifiedDiffError(
			`Hunk "${hunk.header}" is cut short: it says ${oldCount} old and ${newCount} new lines, ` +
				`but has ${hunk.oldLines.length} and ${hunk.newLines.length}.`,
		);
	}
	return [hunk, i];
}

function stripPrefix(raw: string): string | null {
	const pathPart = raw.split("\t")[0].trim();
	if (pathPart === "/dev/null") return null;
	const slash = pathPart.indexOf("/");
	return slash === -1 ? pathPart : pathPart.slice(slash + 1);
}

/**
 * Applies one file's hunks to its content (`undefined` when the file doesn't exist) and
 * returns the new content, or `null` when the patch deletes the file. Context must match
 * exactly; a hunk may sit some lines away from where its header says, as `git apply` allows.
 */
function apply(content: string | undefined, diff: FileDiff): string | null {
	if (diff.oldPath == null && content != null) {
		throw new UnifiedDiffError("the patch creates it, but it already exists");
	}
	if (diff.oldPath != null && content == null) {
		throw new UnifiedDiffError("the file doesn't exist");
	}

	const source = content ?? "";
	let endsWithNewline = source === "" || source.endsWith("\n");
	const lines = source === "" ? [] : source.split("\n");
	if (source.endsWith("\n")) lines.pop();

	let offset = 0;
	let floor = 0;
	diff.hunks.forEach((hunk, index) => {
		const oldIndex = hunk.oldLines.length === 0 ? hunk.oldStart : hunk.oldStart - 1;
		const at = locate(lines, hunk, oldIndex + offset, floor, endsWithNewline);
		if (at == null) {
			throw new UnifiedDiffError(`hunk ${index + 1} (${hunk.header}) doesn't match the file`);
		}
		const reachesEnd = at + hunk.oldLines.length === lines.length;
		lines.splice(at, hunk.oldLines.length, ...hunk.newLines);
		if (reachesEnd) {
			endsWithNewline = !hunk.newEndsWithoutNewline;
		}
		offset = at - oldIndex + hunk.newLines.length - hunk.oldLines.length;
		floor = at + hunk.newLines.length;
	});

	if (diff.newPath == null) {
		if (lines.length > 0) {
			throw new UnifiedDiffError("the patch deletes it, but it has lines the patch doesn't");
		}
		return null;
	}
	return lines.length === 0 ? "" : `${lines.join("\n")}${endsWithNewline ? "\n" : ""}`;
}

/** The nearest index at or after `floor` where the hunk's old lines match, or undefined. */
function locate(
	lines: readonly string[],
	hunk: Hunk,
	expected: number,
	floor: number,
	endsWithNewline: boolean,
): number | undefined {
	const last = lines.length - hunk.oldLines.length;
	const fits = (at: number) => {
		if (at < floor || at > last) return false;
		for (let i = 0; i < hunk.oldLines.length; i++) {
			if (lines[at + i] !== hunk.oldLines[i]) return false;
		}
		// The file's last line and the hunk must agree on whether a newline follows it.
		if (hunk.oldLines.length > 0 && at === last) {
			return hunk.oldEndsWithoutNewline === !endsWithNewline;
		}
		return !hunk.oldEndsWithoutNewline;
	};
	for (let distance = 0; distance <= lines.length; distance++) {
		if (fits(expected - distance)) return expected - distance;
		if (fits(expected + distance)) return expected + distance;
	}
	return undefined;
}

export const unifiedDiff = { parse, apply };
