import { injectable } from "@decohere/crucible/decorators";
import { Workspace } from "@decohere/workspace";
import type { Action } from "@decohere/devkit/cli";
import { ActionResponse } from "@decohere/devkit/cli";
import { Trace } from "@decohere/devkit/diagnostics";
import { scribe } from "@decohere/scribe";
import ts from "typescript";
import { ForgeError } from "../errors.js";
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
		for (const project of projects) {
			this.#logger.info(`Type-checking ${project.name}`);
		}

		const { diagnostics, formatted } = await this.typeEmitter.checkProject([...projects]);
		const errors = diagnostics.filter(
			(diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
		);

		if (errors.length > 0) {
			throw new ForgeError(formatted || "Type check failed");
		}

		if (formatted.length > 0) {
			this.#logger.info(formatted);
		}

		return ActionResponse.Success(TypeCheck.name);
	};
}
