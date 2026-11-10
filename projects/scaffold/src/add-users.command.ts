import { DecohereCommand } from "@decohere/devkit/cli";
import { AddUsersAction } from "./add-users.action.js";

export class AddUsersCommand extends DecohereCommand {
	public override get actions() {
		return [AddUsersAction];
	}

	public constructor(name: string) {
		super(name);
		this.description(
			"Keep a local profile for each user Auth0 signs in (needs Postgres and Auth0)",
		);
		this.option("-d <directory>", "Workspace directory (default: current directory)", ".");
		this.option("--admin <username>", "The admin user to create on Auth0", "admin");
		this.option("--dry-run", "List what would change, and change nothing (Auth0 included)");
	}
}
