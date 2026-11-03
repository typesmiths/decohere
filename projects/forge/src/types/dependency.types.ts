import type { ResultStatus } from "@decohere/devkit/cli";

export type Package = {
	name: string;
	version?: string;
	isInternal?: boolean;
	isDev?: boolean;
};

export type ResolvedDependency =
	| { name: string; version: string; internal: boolean; missing: false; isDev: boolean }
	| { name: string; version: undefined; internal: undefined; missing: true; isDev: false };

export type SyncprojectResult = ResultStatus & {
	projectName: string;
	drift?: DriftEntry | null;
};

export type DependencyLists = {
	dependencies: Record<string, string>;
	devDependencies: Record<string, string>;
	peerDependencies: Record<string, string>;
};

export type DriftEntry = {
	original: DependencyLists;
	updated: DependencyLists;
};

export type DependencyWarning = {
	file: string;
	line: number;
	message: string;
};
