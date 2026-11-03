export type GitOptions = {
	cwd?: string;
};

export type CommitOptions = {
	files?: string[];
	all?: boolean;
} & GitOptions;

export type PushOptions = {
	setUpstream: string;
} & GitOptions;

export type StageOptions = {
	files?: string[];
	all?: string;
};
