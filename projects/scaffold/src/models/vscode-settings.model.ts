import { WELL_KNOWN_FILES } from "./const.js";
import type { KeyedModel, SourceFile } from "./source-file.js";

export class VSCodeSettings implements KeyedModel {
	public readonly key = WELL_KNOWN_FILES.VSCODE_SETTINGS;

	public constructor(private readonly title: string) {}

	public files(): SourceFile[] {
		return [
			{
				filePath: ".vscode/settings.json",
				content: JSON.stringify(
					{
						"window.title": `${this.title}\${separator}\${activeEditorShort}`,
						"window.titleSeparator": " | ",
						"editor.defaultFormatter": "esbenp.prettier-vscode",
						"editor.formatOnSave": true,
					},
					null,
					2,
				),
			},
		];
	}
}
