import { injectable } from "@decohere/crucible/decorators";
import { Workspace } from "@decohere/workspace";
import type { Action } from "@decohere/devkit/cli";
import { ActionResponse } from "@decohere/devkit/cli";
import { Trace } from "@decohere/devkit/diagnostics";
import { scribe } from "@decohere/scribe";
import ts from "typescript";
import { ForgeError } from "../errors.js";
import { runOwnScripts } from "../services/own-scripts.js";
import { TypeEmitter } from "../services/type-emitter.js";

export type TypeCheckOptions = {
	configuration: string;
};

@Trace
@injectable()
export class TypeCheck implements Action<TypeCheckOptions> {
	#logger = scribe.logger(TypeCheck.name);

	public constructor(
		private readonly workspace: Workspace,
		private readonly typeEmitter: TypeEmitter,
	) {}

	public run = async (options: TypeCheckOptions): Promise<ActionResponse> => {
		const projects = this.workspace.getProjects(options.configuration);
		// A project with its own `check` script (`astro check`, `svelte-check`) is checked by it:
		// only the framework's checker reads its component files and its virtual modules.
		const checked = projects.filter((project) => project.getOwnScript("check") == null);
		for (const project of checked) {
			this.#logger.info(`Type-checking ${project.name}`);
		}

		const { diagnostics, formatted } =
			checked.length > 0
				? await this.typeEmitter.checkProject([...checked])
				: { diagnostics: [], formatted: "" };
		const errors = diagnostics.filter(
			(diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
		);

		if (errors.length > 0) {
			throw new ForgeError(formatted || "Type check failed");
		}

		if (formatted.length > 0) {
			this.#logger.info(formatted);
		}

		await runOwnScripts(
			projects.filter((project) => project.getOwnScript("check") != null),
			{
				script: "check",
				verb: "Type-checking",
				workspaceRoot: this.workspace.rootDir,
				logger: this.#logger,
			},
		);

		return ActionResponse.Success(TypeCheck.name);
	};
}
