import { ConfigurationServiceToken } from "@decohere/core/configuration";
import type { IConfigurationService } from "@decohere/core/configuration";
import { inject, injectable } from "@decohere/crucible/decorators";
import { SampleConfig } from "../sample.config.js";

@injectable()
export class SampleService {
	public constructor(
		@inject(ConfigurationServiceToken) private readonly config: IConfigurationService,
	) {}

	public async getGreeting(): Promise<string> {
		const config = await this.config.get(SampleConfig);
		return config.greeting;
	}
}
