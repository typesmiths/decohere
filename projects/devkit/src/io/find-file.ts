import { glob } from "glob";
import { FileEx } from "@decohere/core/io";

export type FindFileOptions = {
	cwd: string;
	ignore?: string | string[];
};

export async function findFile(pattern: string) {
	const files = await glob(pattern, { includeChildMatches: false });
	if (files.length === 0) {
		return;
	}
	const file = {
		relativePath: files.at(0),
	};
	return file;
}

export async function findFiles(
	patterns: string[],
	options?: FindFileOptions,
): Promise<FileEx[]> {
	const paths = await glob(patterns, {
		...options,
		withFileTypes: true,
	});
	const files = paths
		.filter((p) => p.isFile())
		.map((p) => {
			return new FileEx({
				relativePath: p.relative(),
				fullPath: p.fullpath(),
			});
		});
	return files;
}
