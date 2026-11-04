import { defineMeta, getFieldType, getMeta } from "@decohere/core/reflection";
import { MetadataKeys } from "../../const.js";
import type { FieldMeta, RequestPart } from "../http.types.js";

export function Field(fieldLocation?: RequestPart, mappingKey?: string) {
	return (target: object, fieldName: string) => {
		const fieldMap =
			getMeta<Map<string, FieldMeta>>(MetadataKeys.fieldMap, target) ??
			new Map<string, FieldMeta>();

		const fieldType = getFieldType(target, fieldName);
		fieldMap.set(fieldName, { fieldKey: fieldName, mappingKey, fieldType, fieldLocation });
		defineMeta<Map<string, FieldMeta>>(MetadataKeys.fieldMap, fieldMap, target);
	};
}
