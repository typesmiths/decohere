import { ModuleManifest } from "@decohere/devkit/cli";
import { CreateCommand } from "./create.command.js";
import { WebapiAction } from "./webapi.action.js";
import { WebapiCommand } from "./webapi.command.js";

export class CreateModule extends ModuleManifest {
	public readonly id = "create";
	public readonly command = CreateCommand;
	public readonly commands = { webapi: WebapiCommand };
	public readonly actions = { webapi: WebapiAction };
}
