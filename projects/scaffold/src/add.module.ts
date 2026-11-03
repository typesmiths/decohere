import { ModuleManifest } from "@decohere/devkit/cli";
import { AddCommand } from "./add.command.js";
import { AddApiAction } from "./add-api.action.js";
import { AddApiCommand } from "./add-api.command.js";

export class AddModule extends ModuleManifest {
	public readonly id = "add";
	public readonly command = AddCommand;
	public readonly commands = { api: AddApiCommand };
	public readonly actions = { api: AddApiAction };
}
