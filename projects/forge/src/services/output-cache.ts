import { io } from "@decohere/core/io";
import type { TransformResponse } from "../types/transform-response.model.js";

/** The outputs each source file last built to, so watch mode can delete them when it goes. */
export class OutputCache {
	readonly #bySource = new Map<string, TransformResponse[]>();

	public get(sourcePath: string): TransformResponse[] | undefined {
		return this.#bySource.get(sourcePath);
	}

	/** Records the successful outputs, replacing what each of their source files had before. */
	public record(responses: TransformResponse[]): void {
		const bySource = new Map<string, TransformResponse[]>();
		for (const response of responses) {
			if (response.outcome !== "success") continue;
			const group = bySource.get(response.file.fullPath) ?? [];
			group.push(response);
			bySource.set(response.file.fullPath, group);
		}
		for (const [sourcePath, group] of bySource) {
			this.#bySource.set(sourcePath, group);
		}
	}

	/** Deletes the files a source built to and forgets them. */
	public delete(sourcePath: string): void {
		const outputs = this.#bySource.get(sourcePath);
		if (outputs == null) return;
		for (const response of outputs) {
			if (response.outputPath != null) {
				void io.deleteFile(response.outputPath);
			}
		}
		this.#bySource.delete(sourcePath);
	}
}
