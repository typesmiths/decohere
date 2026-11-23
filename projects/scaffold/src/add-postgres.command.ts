import { DecohereCommand } from "@decohere/devkit/cli";
import { AddPostgresAction } from "./add-postgres.action.js";

export class AddPostgresCommand extends DecohereCommand {
	public override get actions() {
		return [AddPostgresAction];
	}

	public constructor(name: string) {
		super(name);
		this.description("Add Postgres, and a database for each API");
		this.option("-d <directory>", "Workspace directory (default: current directory)", ".");
		this.option("--orm <orm>", "ORM: mikro-orm | typeorm", "mikro-orm");
		this.option("--dry-run", "List what would change, and change nothing");
	}
}
