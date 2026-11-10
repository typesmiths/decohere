import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";

/** A change the scaffolder left to the user, because the file no longer has the shape it wrote. */
export type ByHand = { file: string; lines: string[] };

/**
 * The files a scaffolder command changes in a workspace, kept in memory until `commit()`. A later
 * change reads what an earlier one wrote, and `--dry-run` lists them without writing.
 */
export class WorkspaceChanges {
	readonly #pending = new Map<string, string>();
	readonly #byHand: ByHand[] = [];
	#lastMigrationStamp = 0;

	/** @param root The workspace folder. Paths are relative to it, with `/`. */
	public constructor(
		public readonly root: string,
		private readonly now = () => new Date(),
	) {}

	public read(path: string): string | undefined {
		const pending = this.#pending.get(path);
		if (pending != null) return pending;
		const full = join(this.root, path);
		return existsSync(full) ? readFileSync(full, "utf8") : undefined;
	}

	public write(path: string, content: string): void {
		this.#pending.set(path, content);
	}

	/** The names of the files in a folder, written or about to be. */
	public listFiles(dir: string): string[] {
		const full = join(this.root, dir);
		const onDisk = existsSync(full)
			? readdirSync(full, { withFileTypes: true })
					.filter((entry) => entry.isFile())
					.map((entry) => entry.name)
			: [];
		const pending = [...this.#pending.keys()]
			.filter((path) => posix.dirname(path) === dir)
			.map((path) => posix.basename(path));
		return [...new Set([...onDisk, ...pending])].sort();
	}

	/** Says what the user has to change in a file, once per line. */
	public tellByHand(file: string, lines: readonly string[]): void {
		const entry = this.#byHand.find((item) => item.file === file);
		if (entry == null) {
			this.#byHand.push({ file, lines: [...lines] });
			return;
		}
		for (const line of lines) if (!entry.lines.includes(line)) entry.lines.push(line);
	}

	public get byHand(): readonly ByHand[] {
		return this.#byHand;
	}

	/**
	 * A migration id: the time, then the name, as `db new` writes it. Each one is at least a second
	 * after the one before, so migrations added in one run keep their order.
	 */
	public stampMigration(name: string): string {
		const stamp = Math.max(this.now().getTime(), this.#lastMigrationStamp + 1000);
		this.#lastMigrationStamp = stamp;
		const at = new Date(stamp);
		const two = (n: number) => String(n).padStart(2, "0");
		const date = `${at.getUTCFullYear()}${two(at.getUTCMonth() + 1)}${two(at.getUTCDate())}`;
		const time = `${two(at.getUTCHours())}${two(at.getUTCMinutes())}${two(at.getUTCSeconds())}`;
		return `${date}-${time}-${name}`;
	}

	/** The files whose content would change on disk, sorted. */
	public changedFiles(): string[] {
		const full = (path: string) => join(this.root, path);
		return [...this.#pending]
			.filter(
				([path, content]) =>
					!existsSync(full(path)) || readFileSync(full(path), "utf8") !== content,
			)
			.map(([path]) => path)
			.sort();
	}

	/** Writes every changed file, and returns their paths. */
	public commit(): string[] {
		const changed = this.changedFiles();
		for (const path of changed) {
			const full = join(this.root, path);
			mkdirSync(dirname(full), { recursive: true });
			writeFileSync(full, this.#pending.get(path) ?? "");
		}
		return changed;
	}
}
