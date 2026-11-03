import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { transpileCache } from "@decohere/forge";
import { type Logger, scribe } from "@decohere/scribe";

/** Bump when what flux stores changes, so older entries stop matching. */
const FORMAT = 1;
/** Entries untouched for this long are pruned. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Pruning runs at most this often, recorded by the mtime of a marker file. */
const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;
const PRUNE_MARKER = ".last-prune";

/**
 * Compiled code on disk, so a cold start doesn't compile files that haven't changed.
 * Content-addressed: the key hashes the file's path and source, the SWC options it compiles
 * with, SWC's version and this cache's format, so any change to those is a miss, never a stale
 * hit. Entries are written to a temp file and renamed into place, so a process reading an entry
 * another is writing sees all of it or none.
 *
 * The cache is an optimisation: if it can't read or write its directory, it says so once and
 * turns itself off for the process, and flux compiles as it would without it.
 */
export class TranspileDiskCache {
	private readonly logger: Logger = scribe.logger(TranspileDiskCache.name);
	private disabled = false;

	private constructor(private readonly dir: string) {}

	/** The cache for a workspace, or null when caching is off (`DECOHERE_CACHE=0`). */
	public static forWorkspace(rootDir: string): TranspileDiskCache | null {
		const base = transpileCache.directory(rootDir);
		return base == null ? null : new TranspileDiskCache(path.join(base, "flux"));
	}

	public get directory(): string {
		return this.dir;
	}

	/**
	 * The key for a file compiled with `baseOptions`: the per-file options are those plus the
	 * file's path (forge's `createFileConfig`), so hashing the base once per project and adding
	 * the path covers them without serialising options for every file.
	 */
	public keyFor(fullPath: string, source: string, baseOptions: object): string {
		return createHash("sha256")
			.update(`${FORMAT}\0${transpileCache.swcVersion}\0${this.optionsHash(baseOptions)}\0`)
			.update(`${fullPath}\0`)
			.update(source)
			.digest("hex");
	}

	private readonly optionsHashes = new WeakMap<object, string>();

	private optionsHash(options: object): string {
		const cached = this.optionsHashes.get(options);
		if (cached != null) return cached;
		const hash = createHash("sha256").update(JSON.stringify(options)).digest("hex");
		this.optionsHashes.set(options, hash);
		return hash;
	}

	public readSync(key: string): string | undefined {
		if (this.disabled) return undefined;
		try {
			return fs.readFileSync(this.entryPath(key), "utf8");
		} catch (error) {
			return this.missOrDisable(error);
		}
	}

	public async read(key: string): Promise<string | undefined> {
		if (this.disabled) return undefined;
		try {
			return await fs.promises.readFile(this.entryPath(key), "utf8");
		} catch (error) {
			return this.missOrDisable(error);
		}
	}

	public writeSync(key: string, code: string): void {
		if (this.disabled) return;
		const file = this.entryPath(key);
		const temp = this.tempPath(file);
		try {
			fs.mkdirSync(path.dirname(file), { recursive: true });
			fs.writeFileSync(temp, code);
			fs.renameSync(temp, file);
		} catch (error) {
			this.disable("write", error);
		}
	}

	public async write(key: string, code: string): Promise<void> {
		if (this.disabled) return;
		const file = this.entryPath(key);
		const temp = this.tempPath(file);
		try {
			await fs.promises.mkdir(path.dirname(file), { recursive: true });
			await fs.promises.writeFile(temp, code);
			await fs.promises.rename(temp, file);
		} catch (error) {
			this.disable("write", error);
		}
	}

	/** Deletes entries older than 30 days, if it hasn't done so in the last day. */
	public async pruneIfDue(now = Date.now()): Promise<void> {
		if (this.disabled) return;
		const marker = path.join(this.dir, PRUNE_MARKER);
		try {
			const last = await fs.promises.stat(marker).then(
				(stat) => stat.mtimeMs,
				(error: NodeJS.ErrnoException) => {
					if (error.code === "ENOENT") return 0;
					throw error;
				},
			);
			if (now - last < PRUNE_EVERY_MS) return;
			await fs.promises.mkdir(this.dir, { recursive: true });
			await fs.promises.writeFile(marker, "");
			for (const shard of await fs.promises.readdir(this.dir, { withFileTypes: true })) {
				if (!shard.isDirectory()) continue;
				const shardDir = path.join(this.dir, shard.name);
				for (const entry of await fs.promises.readdir(shardDir)) {
					// Old entries, and temp files a crashed process left mid-write.
					const file = path.join(shardDir, entry);
					const mtime = await fs.promises.stat(file).then(
						(stat) => stat.mtimeMs,
						(error: NodeJS.ErrnoException) => {
							// Renamed or removed by another process since the listing: nothing to prune.
							if (error.code === "ENOENT") return undefined;
							throw error;
						},
					);
					if (mtime != null && now - mtime > MAX_AGE_MS)
						await fs.promises.rm(file, { force: true });
				}
			}
		} catch (error) {
			this.disable("prune", error);
		}
	}

	private entryPath(key: string): string {
		return path.join(this.dir, key.slice(0, 2), `${key}.js`);
	}

	private tempPath(file: string): string {
		return `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
	}

	/** A missing entry is a miss; any other read error turns the cache off. */
	private missOrDisable(error: unknown): undefined {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.disable("read", error);
		return undefined;
	}

	private disable(operation: string, error: unknown): void {
		if (this.disabled) return;
		this.disabled = true;
		this.logger.warn(
			`Transpile cache turned off for this run: could not ${operation} ${this.dir} (${String(error)}). ` +
				"Flux compiles without it. Set DECOHERE_CACHE_DIR to a writable directory, or DECOHERE_CACHE=0 to silence this.",
		);
	}
}
