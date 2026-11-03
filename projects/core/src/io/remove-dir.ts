import fs from "node:fs/promises";
export type RemoveDirOptions = {
	force: boolean;
	recursive: boolean;
};
export async function removeDir(
	path: string,
	options: RemoveDirOptions = { recursive: false, force: false },
) {
	await fs.rm(path, options);
}
