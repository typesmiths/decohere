export interface IConfigurationDataSource {
	readonly name: string;
	getData(): Promise<Record<string, unknown>>;
}

export abstract class ConfigurationDataSource implements IConfigurationDataSource {
	public abstract readonly name: string;
	public abstract getData(): Promise<Record<string, unknown>>;
}
