export type VersionType = "major" | "minor" | "patch" | "prerelease";

export const VersionTypes = {
	major: "major",
	minor: "minor",
	patch: "patch",
	prerelease: "prerelease",
} satisfies Record<string, VersionType>;

export class SemverError extends Error {
	public constructor(message: string) {
		super(message);
		this.name = SemverError.name;
	}
}

const SEMVER_REGEX = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

type SemverParts = {
	major: number;
	minor: number;
	patch: number;
	prerelease?: string;
};

export class Semver {
	private version: string;

	public constructor(version: string) {
		this.ensureValid(version);
		this.version = version;
	}

	public increment(versionType: VersionType, preid = "pre"): Semver {
		const { major, minor, patch, prerelease } = this.parse(this.version);

		if (versionType === "major") {
			this.version = `${major + 1}.0.0`;
			return this;
		}

		if (versionType === "minor") {
			this.version = `${major}.${minor + 1}.0`;
			return this;
		}

		if (versionType === "patch") {
			this.version = `${major}.${minor}.${patch + 1}`;
			return this;
		}

		if (prerelease == null) {
			this.version = `${major}.${minor}.${patch + 1}-${preid}.0`;
			return this;
		}

		const [identifier, ...rest] = prerelease.split(".");
		const maybeCounter = rest.at(-1);
		const counter = maybeCounter != null ? Number.parseInt(maybeCounter, 10) : Number.NaN;
		if (identifier === preid && Number.isFinite(counter)) {
			const nextCounter = counter + 1;
			const prefix = rest.length > 1 ? `${rest.slice(0, -1).join(".")}.` : "";
			this.version = `${major}.${minor}.${patch}-${preid}.${prefix}${nextCounter}`;
			return this;
		}

		this.version = `${major}.${minor}.${patch}-${preid}.0`;
		return this;
	}

	/** This version's major.minor.patch with `prerelease` in place of any it has now. */
	public withPrerelease(prerelease: string): Semver {
		const { major, minor, patch } = this.parse(this.version);
		return new Semver(`${major}.${minor}.${patch}-${prerelease}`);
	}

	public toString(): string {
		return this.version;
	}

	private ensureValid(version: string): void {
		if (SEMVER_REGEX.test(version)) {
			return;
		}

		throw new SemverError(`Invalid semantic version: ${version}`);
	}

	private parse(version: string): SemverParts {
		const match = version.match(SEMVER_REGEX);
		if (match == null) {
			throw new SemverError(`Invalid semantic version: ${version}`);
		}

		return {
			major: Number.parseInt(match[1], 10),
			minor: Number.parseInt(match[2], 10),
			patch: Number.parseInt(match[3], 10),
			prerelease: match[4],
		};
	}
}
