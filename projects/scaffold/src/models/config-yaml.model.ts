import { readFileSync } from "node:fs";
import type { KeyedModel, SourceFile } from "./source-file.js";

/**
 * Builder for a YAML config file (e.g. config/config.yaml or config/config.dev.yaml).
 *
 * Starts with a base section passed to the constructor. Features call
 * `addSection(yaml)` during their scaffold phase to append their own block.
 * `files()` joins all sections with a blank line separator.
 */
export class ConfigYaml implements KeyedModel {
	private readonly _sections: string[] = [];

	public constructor(
		public readonly key: string,
		private readonly filePath: string,
		baseContent: string,
	) {
		this._sections.push(baseContent);
	}

	public addSection(yaml: string): this {
		this._sections.push(yaml);
		return this;
	}

	/** True when a datasource with this `name:` already appears in the file. */
	public hasDataSource(name: string): boolean {
		return this._sections.join("\n").includes(`name: ${name}\n`);
	}

	public hasDataSources(): boolean {
		return this._sections.join("\n").includes("dataSources:");
	}

	/**
	 * Insert a `dataSources` list item. Used by `webapi add` so we do not write a
	 * second top-level `database:` key (YAML last-key-wins).
	 */
	public appendDataSource(item: string): this {
		const current = this._sections.join("\n");
		this._sections.length = 0;
		this._sections.push(injectYamlDataSource(current, item));
		return this;
	}

	public static fromFile(key: string, relativePath: string, absolutePath: string): ConfigYaml {
		const content = readFileSync(absolutePath, "utf8");
		return new ConfigYaml(key, relativePath, content);
	}

	public files(): SourceFile[] {
		return [{ filePath: this.filePath, content: this._sections.join("\n") }];
	}
}

/** Insert a YAML list item under `dataSources:`; append a new `database:` block if missing. */
export function injectYamlDataSource(yaml: string, item: string): string {
	const block = item.replace(/\n$/, "");
	if (!yaml.includes("dataSources:")) {
		const prefix = yaml.trimEnd();
		const section = `database:\n  dataSources:\n${block}\n`;
		return prefix.length > 0 ? `${prefix}\n\n${section}` : section;
	}
	const lines = yaml.split("\n");
	const dsIndex = lines.findIndex((line) => /^\s*dataSources:\s*$/.test(line));
	if (dsIndex < 0) {
		return `${yaml.trimEnd()}\n\ndatabase:\n  dataSources:\n${block}\n`;
	}
	let insertAt = lines.length;
	for (let i = dsIndex + 1; i < lines.length; i++) {
		if (/^[A-Za-z]/.test(lines[i] ?? "")) {
			insertAt = i;
			break;
		}
	}
	const insertLines = block.split("\n");
	if (insertAt < lines.length && lines[insertAt - 1] !== "") {
		insertLines.push("");
	}
	lines.splice(insertAt, 0, ...insertLines);
	return lines.join("\n");
}
