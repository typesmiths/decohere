import fs from "node:fs/promises";
import path from "node:path";

export type WriteFileOptions = {
	mkdir?: boolean;
	encoding?: BufferEncoding;
};

export async function writeFile(
	filePath: string,
	content: string,
	options: WriteFileOptions = { encoding: "utf8", mkdir: false },
): Promise<void> {
	const { encoding, mkdir } = options;
	if (mkdir) {
		const directory = path.dirname(filePath);
		await fs.mkdir(directory, { recursive: true });
	}

	await fs.writeFile(filePath, content, encoding);
}
