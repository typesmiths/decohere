export interface SourceFileProvider {
	files(): SourceFile[];
}

/** A SourceFileProvider that knows its own registration key. */
export interface KeyedModel extends SourceFileProvider {
	readonly key: string;
}

export type SourceFile = {
	filePath: string;
	content: string;
};
