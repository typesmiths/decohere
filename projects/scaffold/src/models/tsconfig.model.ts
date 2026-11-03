import { WELL_KNOWN_FILES } from "./const.js";
import type { KeyedModel, SourceFile } from "./source-file.js";

export class TsConfig implements KeyedModel {
	public readonly key = WELL_KNOWN_FILES.TSCONFIG;

	public files(): SourceFile[] {
		return [
			{
				filePath: "tsconfig.json",
				content: JSON.stringify(
					{
						compilerOptions: {
							target: "ES2022",
							module: "NodeNext",
							moduleResolution: "NodeNext",
							strict: true,
							skipLibCheck: true,
							experimentalDecorators: true,
							emitDecoratorMetadata: true,
						},
					},
					null,
					2,
				),
			},
		];
	}
}
