import fs from "node:fs/promises";
import path from "node:path";

export type CopyFileOptions = {
	mkdir?: boolean;
};

export async function copyFile(src: string, dest: string, options: CopyFileOptions = {}) {
	if (options.mkdir) {
		await fs.mkdir(path.dirname(dest), { recursive: true });
	}
	await fs.copyFile(src, dest);
}
