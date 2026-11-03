import { glob } from "glob";
import type { Directory } from "@decohere/core/io";

export async function findDirectories(...pattern: string[]): Promise<Directory[]> {
	const paths = await glob(pattern, { withFileTypes: true });
	const dirs = paths
		.filter((p) => p.isDirectory())
		.map((p) => ({
			name: p.name,
			parentPath: p.parentPath,
		}));
	return dirs;
}
