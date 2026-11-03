import { WELL_KNOWN_FILES } from "./const.js";
import type { KeyedModel, SourceFile } from "./source-file.js";

export class LaunchJson implements KeyedModel {
	public readonly key = WELL_KNOWN_FILES.LAUNCH_JSON;

	public constructor(private readonly apiNames: readonly string[] = ["api"]) {}

	public files(): SourceFile[] {
		const configurations: Record<string, unknown>[] = [
			{
				name: "Build",
				type: "node",
				request: "launch",
				runtimeExecutable: "pnpm",
				runtimeArgs: ["build"],
				console: "integratedTerminal",
				cwd: "${workspaceFolder}",
			},
		];

		const first = this.apiNames[0] ?? "api";
		const defaultDevArgs =
			first === "api" && this.apiNames.length === 1 ? ["dev"] : ["run", `dev:${first}`];
		configurations.push(serveConfig("Serve / Dev", defaultDevArgs));

		for (const apiName of this.apiNames) {
			if (apiName === first && this.apiNames.length === 1 && apiName === "api") continue;
			configurations.push(serveConfig(`Serve / Dev (${apiName})`, ["run", `dev:${apiName}`]));
		}

		return [
			{
				filePath: ".vscode/launch.json",
				content: JSON.stringify(
					{
						version: "0.2.0",
						configurations,
					},
					null,
					2,
				),
			},
		];
	}
}

function serveConfig(name: string, runtimeArgs: string[]): Record<string, unknown> {
	return {
		name,
		type: "node",
		request: "launch",
		runtimeExecutable: "pnpm",
		runtimeArgs,
		console: "integratedTerminal",
		cwd: "${workspaceFolder}",
	};
}
