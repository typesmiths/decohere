import { DataError } from "./error.js";

/**
 * A transaction setting whose name isn't one of the app's own (`prefix.name`, such as
 * `app.tenant_id`). Built-in settings such as `search_path` or `role` are refused: a unit of work
 * sets them on every transaction, so a bad value would change how every query runs.
 */
export class InvalidTransactionSettingError extends DataError {
	public override readonly name = "InvalidTransactionSettingError";

	public constructor(public readonly setting: string) {
		super(
			`Transaction setting ${JSON.stringify(setting)} isn't the app's own: name it prefix.name, such as "app.tenant_id"`,
		);
	}
}
