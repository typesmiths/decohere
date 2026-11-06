import { ModuleManifest } from "@decohere/devkit/cli";
import { AddCommand } from "./add.command.js";
import { AddApiAction } from "./add-api.action.js";
import { AddApiCommand } from "./add-api.command.js";
import { AddAuth0Action } from "./add-auth0.action.js";
import { AddAuth0Command } from "./add-auth0.command.js";

export class AddModule extends ModuleManifest {
	public readonly id = "add";
	public readonly command = AddCommand;
	public readonly commands = { api: AddApiCommand, auth0: AddAuth0Command };
	public readonly actions = { api: AddApiAction, auth0: AddAuth0Action };
}
