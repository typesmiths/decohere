import { defineMeta, getMeta } from "@decohere/core/reflection";
import { MetadataKeys } from "../../const.js";

/** Set the HTTP status code returned on a successful handler response. */
export function HttpCode(statusCode: number) {
	return (_target: object, _methodName: string, descriptor: PropertyDescriptor) => {
		defineMeta(MetadataKeys.httpCode, statusCode, descriptor.value);
	};
}

/** Set a response header on a successful handler response. Stackable. */
export function Header(name: string, value: string) {
	return (_target: object, _methodName: string, descriptor: PropertyDescriptor) => {
		const existing =
			getMeta<Record<string, string>>(MetadataKeys.headers, descriptor.value) ?? {};
		defineMeta(MetadataKeys.headers, { ...existing, [name]: value }, descriptor.value);
	};
}
