export type NpmOptions = {
	cwd?: string;
};

export type PublishOptions = {
	dryRun?: boolean;
	skipIfPublished?: boolean;
	authToken?: string;
	otp?: string;
	provenance?: boolean;
	/** @deprecated use channel */
	versionType?: VersionType;
	channel?: string;
} & NpmOptions;

export type VersionType = "major" | "minor" | "patch" | "prerelease";

export const VersionTypes = {
	major: "major",
	minor: "minor",
	patch: "patch",
	prerelease: "prerelease",
} satisfies Record<VersionType, VersionType>;

export type VersionOptions = {
	preid?: string;
	noTag?: boolean;
} & NpmOptions;
