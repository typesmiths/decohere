import { readFileSync } from "node:fs";
import { WELL_KNOWN_FILES } from "./const.js";
import type { KeyedModel, SourceFile } from "./source-file.js";

export class Gitignore implements KeyedModel {
	public readonly key = WELL_KNOWN_FILES.GITIGNORE;
	private ignoreList = [
		"node_modules",
		"dist",
		".package",
		".pnpm-store",
		".env",
		".devcontainer/gh.env",
		".DS_Store",
		"logs",
	];

	/** Load an existing .gitignore so `decohere add api` appends instead of replacing. */
	public static fromFile(absolutePath: string): Gitignore {
		const gitignore = new Gitignore();
		gitignore.ignoreList = readFileSync(absolutePath, "utf8").replace(/\n+$/, "").split("\n");
		return gitignore;
	}

	public add(...patterns: string[]): this {
		for (const pattern of patterns) {
			if (!this.ignoreList.includes(pattern)) {
				this.ignoreList.push(pattern);
			}
		}
		return this;
	}

	public files(): SourceFile[] {
		return [
			{
				filePath: ".gitignore",
				content: `${this.ignoreList.join("\n")}\n`,
			},
		];
	}
}
