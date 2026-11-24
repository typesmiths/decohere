import { InvalidTransactionSettingError } from "./invalid-transaction-setting.error.js";

/** A setting of the app's own: two identifiers joined by a dot, as Postgres names custom settings. */
const OWN_SETTING = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/i;

/**
 * The settings a unit of work makes at the start of each transaction, such as the tenant a
 * row-level security policy reads with `current_setting('app.tenant_id', true)`. They last only as
 * long as the transaction, so a pooled connection never carries them into another unit of work.
 */
export class TransactionSettings {
	public static readonly none = new TransactionSettings([]);

	private constructor(private readonly values: readonly (readonly [string, string])[]) {}

	/** @throws {InvalidTransactionSettingError} for a name that isn't `prefix.name`. */
	public static of(values: Readonly<Record<string, string>>): TransactionSettings {
		const entries = Object.entries(values);
		for (const [name] of entries) {
			if (!OWN_SETTING.test(name)) {
				throw new InvalidTransactionSettingError(name);
			}
		}
		return new TransactionSettings(entries);
	}

	public get isEmpty(): boolean {
		return this.values.length === 0;
	}

	/** Each setting's name and value, in the order given. */
	public entries(): (readonly [string, string])[] {
		return [...this.values];
	}
}
