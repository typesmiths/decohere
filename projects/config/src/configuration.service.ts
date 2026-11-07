import { inject, injectable } from "@decohere/crucible/decorators";
import { cache, memoize } from "@decohere/core/caching";
import type { IConfigurationService } from "@decohere/core/configuration";
import type { Constructable } from "@decohere/core/reflection";
import { isDevelopmentEnv, lowerCamelCase } from "@decohere/core/system";
import { Ajv, type ErrorObject } from "ajv";
import type { ConfigurationDataSource } from "./configuration-data-source.js";
import { ConfigurationDataSourceKey } from "./const.js";
import { ConfigurationError } from "./errors.js";
import { assertSafeKeys, isTree, mergeTrees, type Tree, withoutNulls } from "./tree-merge.js";

/** Environment values are always text, so a schema's types coerce them. */
const ajv = new Ajv({ allErrors: true, coerceTypes: true, strict: false });

/** `devOnly: true` in a schema: this key may only have a value when NODE_ENV says development. */
ajv.addKeyword({
	keyword: "devOnly",
	schemaType: "boolean",
	error: { message: 'is only allowed when NODE_ENV is "development" or "dev"' },
	validate: (flagged: boolean) => !flagged || isDevelopmentEnv(),
});

type WithSchema = { schema?: object };

function sectionName(type: Constructable): string {
	return lowerCamelCase(type.name.replace(/configuration|config/i, ""));
}

/** `section.path: reason`. Only the path and the rule, never the value: it may be a secret. */
function describeIssue(
	section: string,
	{ instancePath, keyword, message, params }: ErrorObject,
) {
	const path = instancePath.split("/").filter(Boolean);
	if (keyword === "required") path.push(String(params.missingProperty));
	if (keyword === "additionalProperties") path.push(String(params.additionalProperty));
	return `  - ${[section, ...path].join(".")}: ${message ?? keyword}`;
}

function assertValid(section: string, schema: object, data: Tree): void {
	const validate = ajv.compile(schema);
	if (validate(data)) return;
	const issues = (validate.errors ?? []).map((issue) => describeIssue(section, issue));
	throw new ConfigurationError(
		`Invalid config in section "${section}":\n${issues.join("\n")}`,
	);
}

@injectable()
export class ConfigurationService implements IConfigurationService {
	protected data: Tree = {};
	public readonly dataSources: readonly ConfigurationDataSource[] = [];
	protected isInitialized = false;

	public constructor(
		@inject(ConfigurationDataSourceKey) dataSources: ConfigurationDataSource[] = [],
	) {
		this.dataSources = dataSources;
	}

	private async initialize(): Promise<void> {
		if (this.isInitialized) {
			return;
		}

		const records = await Promise.all(this.dataSources.map(async (d) => await d.getData()));
		records.forEach((record, index) => {
			assertSafeKeys(record, this.dataSources[index]?.name ?? String(index));
		});
		this.data = withoutNulls(records.reduce<Tree>(mergeTrees, {}));
		this.isInitialized = true;
	}

	/**
	 * A section by its name, or as an instance of its class. The class's field values are the
	 * defaults, and a `static schema` (JSON Schema) on it is checked, with text coerced to the types
	 * it asks for. The section comes from the class's name: `PaymentsConfig` reads `payments`.
	 * A key set to null counts as unset. In a schema, `devOnly: true` refuses a key's value when
	 * NODE_ENV doesn't say development.
	 *
	 * @throws {ConfigurationError} if the section breaks the schema, naming each bad path.
	 */
	public async get<T extends object>(typeOrString: Constructable<T> | string): Promise<T> {
		await this.ensureInitialized();

		const obj =
			typeof typeOrString === "string"
				? this.getStringKey<T>(typeOrString)
				: this.getConstructable<T>(typeOrString);
		return obj;
	}

	private async ensureInitialized(): Promise<void> {
		if (this.isInitialized) return;
		await this.initialize();
	}

	@memoize()
	private getConstructable<T extends object>(type: Constructable<T>): T {
		const section = sectionName(type);
		const data = this.data[section] ?? {};
		if (!isTree(data)) {
			throw new ConfigurationError(`Config section "${section}" must be a mapping`);
		}
		const configObject = new type();
		const defaults = Object.fromEntries(Object.entries(configObject));
		const merged = structuredClone(withoutNulls(mergeTrees(defaults, data)));
		const { schema } = type as WithSchema;
		if (schema) assertValid(section, schema, merged);
		Object.assign(configObject, merged);
		return configObject as T;
	}

	@cache()
	private getStringKey<T>(key: string): T {
		const data = this.data[key];
		return data as T;
	}
}
