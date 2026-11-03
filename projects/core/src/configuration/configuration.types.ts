import type { Constructable } from "../reflection/index.js";

export const ConfigurationServiceToken = Symbol("IConfigurationService");

export interface IConfigurationService {
	readonly dataSources: readonly IConfigurationDataSource[];
	get<T extends object>(typeOrString: Constructable<T> | string): Promise<T>;
}

export interface IConfigurationDataSource {
	readonly name: string;
	getData(): Promise<Record<string, unknown>>;
}
