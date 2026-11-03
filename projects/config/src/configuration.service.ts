import { inject, injectable } from "@decohere/crucible/decorators";
import { cache, memoize } from "@decohere/core/caching";
import type { IConfigurationService } from "@decohere/core/configuration";
import type { Constructable } from "@decohere/core/reflection";
import { lowerCamelCase } from "@decohere/core/system";
import type { ConfigurationDataSource } from "./configuration-data-source.js";
import { ConfigurationDataSourceKey } from "./const.js";
import { ConfigurationError } from "./errors.js";

@injectable()
export class ConfigurationService implements IConfigurationService {
	protected data: Record<string, unknown> = {};
	public readonly dataSources: readonly ConfigurationDataSource[] = [];
	protected isInitialized = false;

	public constructor(
		@inject(ConfigurationDataSourceKey) dataSources: ConfigurationDataSource[] = [],
	) {
		this.dataSources = dataSources;
	}

	private async initialize(): Promise<void> {
		if (this.isInitialized) {
			return;
		}

		const records = await Promise.all(this.dataSources.map(async (d) => await d.getData()));
		this.validateDataSources(records);
		const entries = records.flatMap((r) => Object.entries(r));
		this.data = Object.fromEntries(entries);
		this.isInitialized = true;
	}

	public async get<T extends object>(typeOrString: Constructable<T> | string): Promise<T> {
		await this.ensureInitialized();

		const obj =
			typeof typeOrString === "string"
				? this.getStringKey<T>(typeOrString)
				: this.getConstructable<T>(typeOrString);
		return obj;
	}

	private async ensureInitialized(): Promise<void> {
		if (this.isInitialized) return;
		await this.initialize();
	}

	private validateDataSources(records: Record<string, unknown>[]) {
		const keys = records.flatMap((record) => Object.keys(record));
		const uniqueKeys = new Set(keys);
		if (uniqueKeys.size < keys.length) {
			throw new ConfigurationError(
				`Cannot have duplicate data source names. The data sources are: ${keys.join(",")}`,
			);
		}
	}

	@memoize()
	private getConstructable<T extends object>(type: Constructable<T>): T {
		const key = lowerCamelCase(type?.name.replace(/configuration|config/i, ""));
		const data = this.data[key];
		const configObject = new type();
		Object.assign(configObject, data);
		return configObject as T;
	}

	@cache()
	private getStringKey<T>(key: string): T {
		const data = this.data[key];
		return data as T;
	}
}
