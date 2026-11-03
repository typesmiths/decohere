export type RepositoryReference =
	| string
	| {
			type?: string;
			url?: string;
			directory?: string;
	  };

export type PackageExports = string | { [key: string]: PackageExports };

type ParsedRepository = {
	owner: string;
	name: string;
};

export class PackageJson {
	private static readonly PACKAGE_JSON_KEY_ORDER = [
		"$schema",
		"name",
		"displayName",
		"version",
		"description",
		"keywords",
		"homepage",
		"bugs",
		"repository",
		"license",
		"author",
		"contributors",
		"funding",
		"type",
		"main",
		"module",
		"types",
		"exports",
		"files",
		"bin",
		"man",
		"directories",
		"scripts",
		"dependencies",
		"devDependencies",
		"peerDependencies",
		"peerDependenciesMeta",
		"optionalDependencies",
		"bundledDependencies",
		"engines",
		"os",
		"cpu",
		"private",
		"publishConfig",
		"workspaces",
		"packageManager",
		"forge",
	] as const;

	public constructor(data?: Partial<PackageJson>) {
		Object.assign(this, data);
		this.dependencies = this.dependencies ?? {};
		this.devDependencies = this.devDependencies ?? {};
	}

	public sort(): this {
		const sorted = this.toSortedPackageJsonRecord();
		Object.assign(this, sorted);
		return this;
	}

	public withVersion(version: string): PackageJson {
		return new PackageJson({ ...this, version });
	}

	public withDependencies(dependencies: Record<string, string>): PackageJson {
		return new PackageJson({ ...this, dependencies });
	}

	public withDevDependencies(devDependencies: Record<string, string>): PackageJson {
		return new PackageJson({ ...this, devDependencies });
	}

	public withPeerDependencies(peerDependencies: Record<string, string>): PackageJson {
		return new PackageJson({ ...this, peerDependencies });
	}

	public toJSON(): string {
		return `${JSON.stringify(this.toSortedPackageJsonRecord(), null, 2)}\n`;
	}

	public getRepositoryOwner() {
		return this.parseRepository()?.owner;
	}

	public getRepositoryName() {
		return this.parseRepository()?.name;
	}

	public getRepositoryFullName() {
		const parsed = this.parseRepository();
		if (parsed == null) {
			return undefined;
		}

		return `${parsed.owner}/${parsed.name}`;
	}

	private sortDependencyMap(input: Record<string, string>) {
		return Object.fromEntries(
			Object.entries(input).sort(([left], [right]) => left.localeCompare(right, "en")),
		);
	}

	private sortPackageJsonKeys(source: Record<string, unknown>) {
		const sorted = Object.create(null) as Record<string, unknown>;

		for (const key of PackageJson.PACKAGE_JSON_KEY_ORDER) {
			if (key in source) {
				sorted[key] = source[key];
			}
		}

		const remainingKeys = Object.keys(source)
			.filter((key) => !PackageJson.PACKAGE_JSON_KEY_ORDER.includes(key as never))
			.sort();

		for (const key of remainingKeys) {
			sorted[key] = source[key];
		}

		return sorted;
	}

	private toSortedPackageJsonRecord() {
		const clone = { ...this } as Record<string, unknown>;
		if (clone.dependencies) {
			clone.dependencies = this.sortDependencyMap(
				clone.dependencies as Record<string, string>,
			);
		}
		if (clone.devDependencies) {
			clone.devDependencies = this.sortDependencyMap(
				clone.devDependencies as Record<string, string>,
			);
		}
		return this.sortPackageJsonKeys(clone);
	}

	private repositoryReferenceToString(repository?: RepositoryReference) {
		if (typeof repository === "string") {
			return repository;
		}

		if (repository == null) {
			return "";
		}

		return String(repository.url ?? "");
	}

	private parseRepository(): ParsedRepository | undefined {
		const repositoryValue = this.repositoryReferenceToString(this.repository);
		if (repositoryValue === "") {
			return undefined;
		}

		const trimmed = repositoryValue.trim();

		if (!trimmed.includes("://") && !trimmed.startsWith("git@")) {
			const shorthand = /^(?:[a-z0-9-]+:)?([^/\s]+)\/([^\s]+)$/i.exec(trimmed);
			if (shorthand) {
				return {
					owner: shorthand[1].toLowerCase(),
					name: this.sanitizeRepositoryName(shorthand[2]),
				};
			}
		}

		const ssh = /^git@[^:]+:([^/\s]+)\/([^\s]+)$/i.exec(trimmed);
		if (ssh) {
			return {
				owner: ssh[1].toLowerCase(),
				name: this.sanitizeRepositoryName(ssh[2]),
			};
		}

		const urlRepository = this.parseRepositoryFromUrl(trimmed);
		if (urlRepository != null) {
			return urlRepository;
		}

		return undefined;
	}

	private parseRepositoryFromUrl(repository: string): ParsedRepository | undefined {
		const normalized = repository.replace(/^git\+/, "");
		let url: URL;
		try {
			url = new URL(normalized);
		} catch {
			return undefined;
		}

		const segments = url.pathname.split("/").filter(Boolean);
		if (segments.length < 2) {
			return undefined;
		}

		const owner = segments[0]?.toLowerCase();
		const name = this.sanitizeRepositoryName(segments[1] ?? "");
		if (owner == null || owner === "" || name === "") {
			return undefined;
		}

		return {
			owner,
			name,
		};
	}

	private sanitizeRepositoryName(name: string) {
		return name.replace(/\.git$/i, "").toLowerCase();
	}

	public readonly name: string;
	public version: string;
	public readonly repository?: RepositoryReference;
	public readonly main: string;
	/** `exports` as written in package.json: a path, or a map of subpaths (values may be condition maps). */
	public readonly exports?: PackageExports;
	public readonly peerDependencies?: Record<string, string>;
	public readonly optionalDependencies?: Record<string, string>;
	public readonly scripts: Record<string, string>;
	public dependencies: Record<string, string> = {};
	public devDependencies: Record<string, string> = {};
	public readonly private?: boolean;
}
