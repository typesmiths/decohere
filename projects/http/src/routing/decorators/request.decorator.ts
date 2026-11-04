import type { Constructable } from "@decohere/core/reflection";
import { defineMeta, getFields, getFieldType, getMeta } from "@decohere/core/reflection";
import { MetadataKeys } from "../../const.js";
import type { FieldMeta, RequestPart } from "../http.types.js";

/**
 * Used to map a request object to route params
 * @param mappingKey
 * @returns
 */
export function Request(mappingKey?: RequestPart) {
	return (target: Constructable) => {
		const inst = new target();

		const fieldMap =
			getMeta<Map<string, FieldMeta>>(MetadataKeys.fieldMap, target.prototype) ??
			new Map<string, FieldMeta>();

		const fields = getFields(inst);

		for (const field of fields) {
			const fieldType = getFieldType(target.prototype, field.key);
			const overrides = fieldMap.get(field.key);
			fieldMap.set(field.key, {
				fieldKey: field.key,
				mappingKey: overrides?.mappingKey ?? field.key,
				fieldType: overrides?.fieldType ?? fieldType,
				fieldLocation: overrides?.fieldLocation ?? mappingKey,
			});
		}

		defineMeta(MetadataKeys.fieldMap, fieldMap, target.prototype);
	};
}
