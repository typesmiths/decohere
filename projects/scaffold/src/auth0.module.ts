import { ModuleManifest } from "@decohere/devkit/cli";
import { Auth0Command } from "./auth0.command.js";
import { Auth0ConfigureAction } from "./auth0-configure.action.js";
import { Auth0ConfigureCommand } from "./auth0-configure.command.js";
import { Auth0LoginAction } from "./auth0-login.action.js";
import { Auth0LoginCommand } from "./auth0-login.command.js";
import { Auth0TokenAction } from "./auth0-token.action.js";
import { Auth0TokenCommand } from "./auth0-token.command.js";

export class Auth0Module extends ModuleManifest {
	public readonly id = "auth0";
	public readonly command = Auth0Command;
	public readonly commands = {
		login: Auth0LoginCommand,
		configure: Auth0ConfigureCommand,
		token: Auth0TokenCommand,
	};
	public readonly actions = {
		login: Auth0LoginAction,
		configure: Auth0ConfigureAction,
		token: Auth0TokenAction,
	};
}
