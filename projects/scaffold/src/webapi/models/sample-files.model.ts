import type { SourceFile, SourceFileProvider } from "../../models/source-file.js";

const SAMPLE_CONFIG_CONTENT = `export class SampleConfig {\n\tpublic greeting: string = "";\n}\n`;

const SAMPLE_SERVICE_CONTENT = [
	`import { inject, injectable } from "@decohere/crucible/decorators";`,
	`import { ConfigurationServiceToken } from "@decohere/core/configuration";`,
	`import type { IConfigurationService } from "@decohere/core/configuration";`,
	`import { SampleConfig } from "../sample.config.js";`,
	``,
	`@injectable()`,
	`export class SampleService {`,
	`\tpublic constructor(`,
	`\t\t@inject(ConfigurationServiceToken) private readonly config: IConfigurationService,`,
	`\t) {}`,
	``,
	`\tpublic async getGreeting(): Promise<string> {`,
	`\t\tconst config = await this.config.get(SampleConfig);`,
	`\t\treturn config.greeting;`,
	`\t}`,
	`}`,
	``,
].join("\n");

export class SampleConfigModel implements SourceFileProvider {
	public files(): SourceFile[] {
		return [
			{
				filePath: "src/sample.config.ts",
				content: SAMPLE_CONFIG_CONTENT,
			},
		];
	}
}

export class SampleServiceModel implements SourceFileProvider {
	public files(): SourceFile[] {
		return [
			{
				filePath: "src/services/sample.service.ts",
				content: SAMPLE_SERVICE_CONTENT,
			},
		];
	}
}
