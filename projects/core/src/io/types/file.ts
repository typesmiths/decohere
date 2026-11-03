import { readFile } from "../read-file.js";

export type File = {
	fullPath: string;
	relativePath: string;
};

export class FileEx implements File {
	public constructor(data: Partial<File> & { content?: string }) {
		this.fullPath = data.fullPath;
		this.relativePath = data.relativePath ?? data.fullPath;
		this.#content = data.content;
	}
	#content?: string;
	public fullPath: string;
	public relativePath: string;
	public toString() {
		return this.relativePath;
	}
	public async getContent() {
		if (this.#content != null) return this.#content;
		return readFile(this.fullPath);
	}
}

export type Watcher = {
	readonly ready: Promise<void>;
	on(event: "ready", handler: () => unknown): Watcher;
	on(
		event: "add" | "change" | "addDir" | "unlink" | "unlinkDir",
		handler: (file: File) => unknown,
	): Watcher;
	close(): void;
};
