import fs from "node:fs/promises";
import type { File } from "./types/file.js";
export async function readFiles(
	filePaths: File[],
	encoding: BufferEncoding = "utf8",
): Promise<string[]> {
	const data = await Promise.all(filePaths.map((file) => readFile(file.fullPath, encoding)));
	return data;
}

export async function readFile(
	filePath: string,
	encoding: BufferEncoding = "utf8",
): Promise<string> {
	const data = await fs.readFile(filePath, encoding);
	return data;
}

export async function readJsonFile<T>(
	filePath: string,
	encoding: BufferEncoding = "utf8",
): Promise<T> {
	const data = await readFile(filePath, encoding);
	return JSON.parse(data);
}
