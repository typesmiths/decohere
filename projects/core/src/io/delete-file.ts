import fs from "node:fs/promises";
export async function deleteFile(filePath: string) {
	return fs.rm(filePath, { force: true });
}
