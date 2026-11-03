import { readFileSync } from "node:fs";
import { WELL_KNOWN_FILES } from "./const.js";
import type { KeyedModel, SourceFile } from "./source-file.js";

/**
 * Accumulates key=value pairs and renders them as a `.env` file.
 *
 * Register once in the workspace; features call `addEntry` during their
 * scaffold phase to contribute environment variables. The final file is
 * written at render time when `workspace.scaffold()` is called.
 */
export class EnvFile implements KeyedModel {
	public readonly key = WELL_KNOWN_FILES.ENV_FILE;

	private readonly _entries = new Map<string, string>();

	public addEntry(key: string, value: string): this {
		this._entries.set(key, value);
		return this;
	}

	public hasEntry(key: string): boolean {
		return this._entries.has(key);
	}

	public static fromFile(absolutePath: string): EnvFile {
		const env = new EnvFile();
		const raw = readFileSync(absolutePath, "utf8");
		for (const line of raw.split("\n")) {
			const trimmed = line.trim();
			if (trimmed === "" || trimmed.startsWith("#")) continue;
			const eq = line.indexOf("=");
			if (eq <= 0) continue;
			env.addEntry(line.slice(0, eq).trim(), line.slice(eq + 1));
		}
		return env;
	}

	public files(): SourceFile[] {
		if (this._entries.size === 0) return [];
		const body = [...this._entries.entries()].map(([k, v]) => `${k}=${v}`).join("\n");
		const content = `${body}\n`;
		return [{ filePath: ".env", content }];
	}
}
