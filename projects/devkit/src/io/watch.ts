import { type FSWatcher, watch as nativeWatch, readdirSync, statSync } from "node:fs";
import path from "node:path";
import picomatch from "picomatch";
import { type File, FileEx, type Watcher } from "@decohere/core/io";

export type WatchOptions = {
	include?: string[];
	ignore?: string[];
	cwd?: string;
	ignoreInitial?: boolean;
};

export type WatchEventName = "add" | "change" | "addDir" | "unlink" | "unlinkDir";
export const WatchEvents = {
	add: "add",
	change: "change",
	addDir: "addDir",
	unlink: "unlink",
	unlinkDir: "unlinkDir",
} satisfies Record<string, WatchEventName>;
export function watch(directory: string, options: WatchOptions = { cwd: "." }) {
	const { include, ignore, ignoreInitial = false } = options;

	const changeCoalesceMs = 25;

	const handlers = {
		ready: new Set<() => unknown>(),
		add: new Set<(file: File) => unknown>(),
		change: new Set<(file: File) => unknown>(),
		addDir: new Set<(file: File) => unknown>(),
		unlink: new Set<(file: File) => unknown>(),
		unlinkDir: new Set<(file: File) => unknown>(),
	};

	let resolveReady: (() => void) | undefined;
	const ready = new Promise<void>((resolve) => {
		resolveReady = resolve;
	});

	const snapshot = buildSnapshot(directory);

	const isFiltered = (relativePath: string) => {
		const posixRelativePath = toPosixPath(relativePath);
		const posixFullPath = toPosixPath(path.resolve(directory, relativePath));
		const matchesEitherPath = (patterns: string[]) =>
			picomatch.isMatch(posixRelativePath, patterns) ||
			picomatch.isMatch(posixFullPath, patterns);

		if (include && include.length > 0) {
			return !matchesEitherPath(include);
		}

		if (ignore && ignore.length > 0) {
			return matchesEitherPath(ignore);
		}

		return false;
	};

	const emit = (event: WatchEventName, relativePath: string) => {
		if (isFiltered(relativePath)) {
			return;
		}

		const fullPath = path.resolve(directory, relativePath);
		for (const handler of handlers[event]) {
			handler(new FileEx({ fullPath, relativePath }));
		}
	};

	const pendingChangeTimers = new Map<string, ReturnType<typeof setTimeout>>();

	const emitChange = (relativePath: string) => {
		const existing = pendingChangeTimers.get(relativePath);
		if (existing != null) {
			clearTimeout(existing);
		}

		const timer = setTimeout(() => {
			pendingChangeTimers.delete(relativePath);
			emit("change", relativePath);
		}, changeCoalesceMs);

		pendingChangeTimers.set(relativePath, timer);
	};

	const emitReady = () => {
		for (const handler of handlers.ready) {
			handler();
		}
	};

	queueMicrotask(() => {
		if (!ignoreInitial) {
			for (const [relativePath, entry] of snapshot) {
				emit(entry.isDirectory ? "addDir" : "add", relativePath);
			}
		}

		emitReady();
		resolveReady?.();
		resolveReady = undefined;
	});

	// One non-recursive watcher per directory. Node's recursive mode on Linux tracks files
	// individually and goes silent for a file once an editor replaces it with an atomic save
	// (write temp file, rename over the original); directory watchers keep seeing it.
	const directoryWatchers = new Map<string, FSWatcher>();

	const watchDirectory = (relativeDir: string) => {
		if (directoryWatchers.has(relativeDir)) {
			return;
		}
		try {
			const watcher = nativeWatch(
				path.resolve(directory, relativeDir),
				(_eventType, fileName) => {
					if (fileName != null) {
						onFsEvent(path.posix.join(relativeDir, toPosixPath(fileName.toString())));
					}
				},
			);
			watcher.on("error", () => unwatchDirectory(relativeDir));
			directoryWatchers.set(relativeDir, watcher);
		} catch {
			// The directory vanished before we could watch it; its unlink event covers it.
		}
	};

	const unwatchDirectory = (relativeDir: string) => {
		for (const [watchedDir, watcher] of directoryWatchers) {
			if (watchedDir === relativeDir || watchedDir.startsWith(`${relativeDir}/`)) {
				watcher.close();
				directoryWatchers.delete(watchedDir);
			}
		}
	};

	/** A directory appeared: watch it, and report what was created in it before we were watching. */
	const addDirectory = (relativeDir: string) => {
		watchDirectory(relativeDir);
		const found = new Map<string, { isDirectory: boolean; fingerprint: string }>();
		try {
			collectSnapshotEntries(directory, path.resolve(directory, relativeDir), found);
		} catch {
			return;
		}
		for (const [relativePath, entry] of found) {
			if (snapshot.has(relativePath)) continue;
			snapshot.set(relativePath, entry);
			if (entry.isDirectory) watchDirectory(relativePath);
			emit(entry.isDirectory ? "addDir" : "add", relativePath);
		}
	};

	/** A directory went away: stop watching it and forget everything that was under it. */
	const removeDirectoryContents = (relativeDir: string) => {
		unwatchDirectory(relativeDir);
		// oxlint-disable-next-line unicorn/no-useless-spread -- iterate a copy: the loop deletes from the snapshot
		for (const [relativePath, entry] of [...snapshot]) {
			if (relativePath.startsWith(`${relativeDir}/`)) {
				snapshot.delete(relativePath);
				emit(entry.isDirectory ? "unlinkDir" : "unlink", relativePath);
			}
		}
	};

	const onFsEvent = (eventPath: string) => {
		const relativePath = eventPath === "." ? "" : eventPath;
		if (relativePath.length === 0) {
			return;
		}

		const fullPath = path.resolve(directory, relativePath);
		const previous = snapshot.get(relativePath);

		try {
			const stat = statSync(fullPath);
			const current = toSnapshotEntry(stat);
			snapshot.set(relativePath, current);

			if (previous == null) {
				emit(current.isDirectory ? "addDir" : "add", relativePath);
				if (current.isDirectory) addDirectory(relativePath);
				return;
			}

			if (previous.isDirectory !== current.isDirectory) {
				if (previous.isDirectory) removeDirectoryContents(relativePath);
				emit(previous.isDirectory ? "unlinkDir" : "unlink", relativePath);
				emit(current.isDirectory ? "addDir" : "add", relativePath);
				return;
			}

			if (!current.isDirectory && previous.fingerprint !== current.fingerprint) {
				emitChange(relativePath);
			}
		} catch {
			if (previous == null) {
				return;
			}

			snapshot.delete(relativePath);
			const pending = pendingChangeTimers.get(relativePath);
			if (pending != null) {
				clearTimeout(pending);
				pendingChangeTimers.delete(relativePath);
			}
			emit(previous.isDirectory ? "unlinkDir" : "unlink", relativePath);
		}
	};

	watchDirectory("");
	for (const [relativePath, entry] of snapshot) {
		if (entry.isDirectory) watchDirectory(relativePath);
	}

	const watchApi: Watcher = {
		ready,
		on(event: "ready" | WatchEventName, handler: ((file: File) => unknown) | (() => unknown)) {
			if (event === "ready") {
				handlers.ready.add(handler as () => unknown);
				return watchApi;
			}

			handlers[event].add(handler as (file: File) => unknown);
			return watchApi;
		},
		close: () => {
			for (const pending of pendingChangeTimers.values()) {
				clearTimeout(pending);
			}
			pendingChangeTimers.clear();
			for (const watcher of directoryWatchers.values()) {
				watcher.close();
			}
			directoryWatchers.clear();
		},
	};

	return watchApi;
}

function buildSnapshot(
	directoryPath: string,
): Map<string, { isDirectory: boolean; fingerprint: string }> {
	const snapshot = new Map<string, { isDirectory: boolean; fingerprint: string }>();
	collectSnapshotEntries(directoryPath, directoryPath, snapshot);
	return snapshot;
}

/** Never source, and huge: watching every folder inside them could exhaust OS watch limits. */
const UNWATCHED_DIRECTORIES = new Set(["node_modules", ".git"]);

function collectSnapshotEntries(
	rootDirectoryPath: string,
	currentDirectoryPath: string,
	snapshot: Map<string, { isDirectory: boolean; fingerprint: string }>,
) {
	for (const entry of readdirSync(currentDirectoryPath, { encoding: "utf8" })) {
		const name = typeof entry === "string" ? entry : String(entry);
		const fullPath = path.join(currentDirectoryPath, name);
		if (UNWATCHED_DIRECTORIES.has(name)) {
			continue;
		}
		const relativePath = toPosixPath(path.relative(rootDirectoryPath, fullPath));
		const stat = statSync(fullPath);
		const snapshotEntry = toSnapshotEntry(stat);

		snapshot.set(relativePath, snapshotEntry);

		if (!snapshotEntry.isDirectory) {
			continue;
		}

		collectSnapshotEntries(rootDirectoryPath, fullPath, snapshot);
	}
}

function toSnapshotEntry(stat: { isDirectory(): boolean; mtimeMs: number; size: number }) {
	const isDirectory = stat.isDirectory();
	return {
		isDirectory,
		fingerprint: isDirectory ? `dir:${stat.mtimeMs}` : `file:${stat.mtimeMs}:${stat.size}`,
	};
}

function toPosixPath(filePath: string) {
	return filePath.split(path.sep).join(path.posix.sep);
}
